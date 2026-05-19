from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from groq import Groq
import os
import uuid
from datetime import datetime
from functools import wraps
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///chatbot.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
client = Groq(api_key=os.environ.get('OPENAI_API_KEY'))

# ─── Models ───────────────────────────────────────────────────────────────────

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    chats = db.relationship('Chat', backref='user', lazy=True, cascade='all, delete-orphan')

class Chat(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = db.Column(db.String(200), default='New Chat')
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    messages = db.relationship('Message', backref='chat', lazy=True, cascade='all, delete-orphan',
                                order_by='Message.created_at')

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.String(36), db.ForeignKey('chat.id'), nullable=False)
    role = db.Column(db.String(20), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# ─── Auth helpers ──────────────────────────────────────────────────────────────

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated

def get_current_user():
    if 'user_id' in session:
        return User.query.get(session['user_id'])
    return None

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username', '').strip()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not username or not email or not password:
        return jsonify({'error': 'All fields are required'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken'}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered'}), 400

    pw_hash = bcrypt.generate_password_hash(password).decode('utf-8')
    user = User(username=username, email=email, password_hash=pw_hash)
    db.session.add(user)
    db.session.commit()

    session['user_id'] = user.id
    return jsonify({'message': 'Account created', 'username': user.username}), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    user = User.query.filter_by(email=email).first()
    if not user or not bcrypt.check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Invalid email or password'}), 401

    session['user_id'] = user.id
    return jsonify({'message': 'Logged in', 'username': user.username})

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'Logged out'})

@app.route('/api/auth/me')
def me():
    user = get_current_user()
    if not user:
        return jsonify({'authenticated': False})
    return jsonify({'authenticated': True, 'username': user.username, 'email': user.email})

@app.route('/api/chats', methods=['GET'])
@login_required
def get_chats():
    user = get_current_user()
    chats = Chat.query.filter_by(user_id=user.id).order_by(Chat.updated_at.desc()).all()
    return jsonify([{
        'id': c.id,
        'title': c.title,
        'updated_at': c.updated_at.isoformat()
    } for c in chats])

@app.route('/api/chats', methods=['POST'])
@login_required
def create_chat():
    user = get_current_user()
    chat = Chat(user_id=user.id)
    db.session.add(chat)
    db.session.commit()
    return jsonify({'id': chat.id, 'title': chat.title}), 201

@app.route('/api/chats/<chat_id>', methods=['GET'])
@login_required
def get_chat(chat_id):
    user = get_current_user()
    chat = Chat.query.filter_by(id=chat_id, user_id=user.id).first()
    if not chat:
        return jsonify({'error': 'Chat not found'}), 404
    return jsonify({
        'id': chat.id,
        'title': chat.title,
        'messages': [{'role': m.role, 'content': m.content} for m in chat.messages]
    })

@app.route('/api/chats/<chat_id>', methods=['DELETE'])
@login_required
def delete_chat(chat_id):
    user = get_current_user()
    chat = Chat.query.filter_by(id=chat_id, user_id=user.id).first()
    if not chat:
        return jsonify({'error': 'Chat not found'}), 404
    db.session.delete(chat)
    db.session.commit()
    return jsonify({'message': 'Chat deleted'})

@app.route('/api/chats/<chat_id>/messages', methods=['POST'])
@login_required
def send_message(chat_id):
    user = get_current_user()
    chat = Chat.query.filter_by(id=chat_id, user_id=user.id).first()
    if not chat:
        return jsonify({'error': 'Chat not found'}), 404

    data = request.get_json()
    user_content = data.get('message', '').strip()
    if not user_content:
        return jsonify({'error': 'Message cannot be empty'}), 400

    user_msg = Message(chat_id=chat.id, role='user', content=user_content)
    db.session.add(user_msg)

    history = [{'role': m.role, 'content': m.content} for m in chat.messages[-20:]]
    history.append({'role': 'user', 'content': user_content})

    try:
        response = client.chat.completions.create(
            model='llama3-8b-8192',
            messages=[
                {'role': 'system', 'content': (
                    'You are a helpful, knowledgeable, and friendly AI assistant. '
                    'Format your responses using Markdown when appropriate. '
                    'Be concise but thorough.'
                )}
            ] + history,
            max_tokens=2048,
            temperature=0.7,
        )
        ai_content = response.choices[0].message.content

    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Groq API error: {str(e)}'}), 500

    ai_msg = Message(chat_id=chat.id, role='assistant', content=ai_content)
    db.session.add(ai_msg)

    if len(chat.messages) == 0:
        title = user_content[:60] + ('…' if len(user_content) > 60 else '')
        chat.title = title

    chat.updated_at = datetime.utcnow()
    db.session.commit()

    return jsonify({'response': ai_content, 'chat_title': chat.title})

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)
