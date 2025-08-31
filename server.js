const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Підключення до MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/travel-diary', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

// Схеми MongoDB
const entrySchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: String,
    location: String,
    photo: String, // base64 encoded image
    date: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    userId: String // для майбутньої авторизації
});

const userSchema = new mongoose.Schema({
    email: { type: String, unique: true },
    name: String,
    createdAt: { type: Date, default: Date.now }
});

const Entry = mongoose.model('Entry', entrySchema);
const User = mongoose.model('User', userSchema);

// API Routes
// Отримати всі записи
app.get('/api/entries', async (req, res) => {
    try {
        const entries = await Entry.find().sort({ timestamp: -1 });
        res.json(entries);
    } catch (error) {
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Додати новий запис
app.post('/api/entries', async (req, res) => {
    try {
        const { title, description, location, photo, date } = req.body;
        
        const newEntry = new Entry({
            title,
            description,
            location,
            photo,
            date,
            userId: 'anonymous' // тимчасово, поки немає авторизації
        });

        const savedEntry = await newEntry.save();
        res.json(savedEntry);
    } catch (error) {
        res.status(500).json({ error: 'Помилка збереження' });
    }
});

// Видалити запис
app.delete('/api/entries/:id', async (req, res) => {
    try {
        await Entry.findByIdAndDelete(req.params.id);
        res.json({ message: 'Запис видалено' });
    } catch (error) {
        res.status(500).json({ error: 'Помилка видалення' });
    }
});

// Оновити запис
app.put('/api/entries/:id', async (req, res) => {
    try {
        const updatedEntry = await Entry.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        res.json(updatedEntry);
    } catch (error) {
        res.status(500).json({ error: 'Помилка оновлення' });
    }
});

// Синхронізація офлайн-даних
app.post('/api/sync', async (req, res) => {
    try {
        const { entries } = req.body;
        const results = [];

        for (const entry of entries) {
            if (entry._id) {
                // Оновлення існуючого запису
                const updated = await Entry.findByIdAndUpdate(
                    entry._id,
                    entry,
                    { new: true }
                );
                results.push(updated);
            } else {
                // Створення нового запису
                const newEntry = new Entry({
                    ...entry,
                    userId: 'anonymous'
                });
                const saved = await newEntry.save();
                results.push(saved);
            }
        }

        res.json(results);
    } catch (error) {
        res.status(500).json({ error: 'Помилка синхронізації' });
    }
});

// Обслуговування PWA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущено на порті ${PORT}`);
    console.log(`📊 Підключено до MongoDB`);
});