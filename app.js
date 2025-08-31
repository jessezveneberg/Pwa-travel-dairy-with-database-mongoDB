class TravelDiary {
    constructor() {
        this.db = null;
        this.currentPhoto = null;
        this.deferredPrompt = null;
        this.geolocationTimeout = null;
        this.isOnline = navigator.onLine;
        this.syncQueue = [];
        this.init();
    }

    async init() {
        await this.initDB();
        this.initEventListeners();
        await this.checkSync();
        await this.displayEntries();
        this.checkOnlineStatus();
        this.setupServiceWorker();
        this.requestNotificationPermission();
    }

    async initDB() {
        try {
            this.db = await idb.openDB('TravelDiaryDB', 2, {
                upgrade(db, oldVersion) {
                    if (!db.objectStoreNames.contains('entries')) {
                        db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
                    }
                    if (!db.objectStoreNames.contains('syncQueue')) {
                        db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
                    }
                    if (!db.objectStoreNames.contains('settings')) {
                        db.createObjectStore('settings', { keyPath: 'key' });
                    }
                }
            });
            
            console.log('База даних ініціалізована');
        } catch (error) {
            console.error('Помилка ініціалізації бази даних:', error);
            this.showToast('❌ Помилка ініціалізації бази даних');
        }
    }

    initEventListeners() {
        // Форма додавання запису
        document.getElementById('entry-form').addEventListener('submit', (e) => this.handleSubmit(e));
        
        // Фото
        document.getElementById('photo').addEventListener('change', (e) => this.handlePhotoUpload(e));
        
        // Геолокація
        document.getElementById('get-location').addEventListener('click', () => this.getLocation());
        
        // Ручне введення локації
        document.getElementById('manual-location').addEventListener('click', () => this.saveManualLocation());
        
        // Генерація PDF
        document.getElementById('generate-pdf').addEventListener('click', () => this.generatePDF());
        
        // Очищення даних
        document.getElementById('clear-data').addEventListener('click', () => this.clearAllData());
        
        // Очищення кешу PWA
        document.getElementById('clear-cache').addEventListener('click', () => this.clearPWACache());
        
        // Встановлення PWA
        window.addEventListener('beforeinstallprompt', (e) => this.handleInstallPrompt(e));
        document.getElementById('install-btn').addEventListener('click', () => this.installApp());
        
        // Онлайн/офлайн статус
        window.addEventListener('online', () => this.handleOnlineStatus());
        window.addEventListener('offline', () => this.handleOfflineStatus());
    }

    async handleSubmit(e) {
        e.preventDefault();
        
        const title = document.getElementById('title').value.trim();
        const description = document.getElementById('description').value.trim();
        const location = document.getElementById('location').value.trim();

        if (!title) {
            this.showToast('Будь ласка, введіть назву подорожі');
            return;
        }

        const entry = {
            title,
            description,
            location,
            photo: this.currentPhoto,
            date: new Date().toLocaleString('uk-UA'),
            timestamp: Date.now(),
            synced: false
        };

        try {
            // Спроба відправити на сервер, якщо онлайн
            if (this.isOnline) {
                try {
                    const savedEntry = await this.saveToServer(entry);
                    if (savedEntry && savedEntry._id) {
                        entry._id = savedEntry._id;
                        entry.synced = true;
                        this.showToast('✅ Запис збережено та синхронізовано!');
                    }
                } catch (serverError) {
                    console.log('Помилка сервера, зберігаємо локально:', serverError);
                    this.showToast('📴 Офлайн режим. Запис збережено локально.');
                }
            } else {
                this.showToast('📴 Офлайн режим. Запис збережено локально.');
            }

            // Зберігаємо локально в будь-якому випадку
            await this.saveToIndexedDB(entry);
            
            this.resetForm();
            await this.displayEntries();
            
        } catch (error) {
            console.error('Помилка збереження:', error);
            this.showToast('❌ Помилка при збереженні запису');
        }
    }

    async saveToServer(entry) {
        const response = await fetch('/api/entries', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title: entry.title,
                description: entry.description,
                location: entry.location,
                photo: entry.photo,
                date: entry.date
            })
        });

        if (!response.ok) {
            throw new Error('Помилка сервера: ' + response.status);
        }

        return await response.json();
    }

    async saveToIndexedDB(entry) {
        const tx = this.db.transaction('entries', 'readwrite');
        const storedEntry = await tx.store.add(entry);
        await tx.done;

        // Додаємо в чергу синхронізації, якщо не синхронізовано
        if (!entry.synced) {
            const syncTx = this.db.transaction('syncQueue', 'readwrite');
            await syncTx.store.add({
                type: 'save-entry',
                data: entry,
                timestamp: Date.now()
            });
            await syncTx.done;
        }

        return storedEntry;
    }

    handlePhotoUpload(e) {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (event) => {
                // Стиснення фото для зменшення розміру
                this.compressImage(event.target.result, 800, 600)
                    .then(compressedPhoto => {
                        this.currentPhoto = compressedPhoto;
                        document.getElementById('photo-preview').innerHTML = `
                            <img src="${this.currentPhoto}" alt="Попередній перегляд">
                        `;
                    })
                    .catch(error => {
                        console.error('Помилка стиснення фото:', error);
                        this.currentPhoto = event.target.result;
                        document.getElementById('photo-preview').innerHTML = `
                            <img src="${this.currentPhoto}" alt="Попередній перегляд">
                        `;
                    });
            };
            reader.readAsDataURL(file);
        }
    }

    compressImage(src, maxWidth, maxHeight) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = src;
            
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };

            img.onerror = reject;
        });
    }

    async getLocation() {
        if (!navigator.geolocation) {
            this.showToast('Геолокація не підтримується вашим браузером');
            this.enableManualLocation();
            return;
        }

        // Перевірка HTTPS для геолокації
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            this.showToast('⚠️ Геолокація працює тільки на HTTPS або localhost');
            this.enableManualLocation();
            return;
        }

        // Скасування попереднього таймауту
        if (this.geolocationTimeout) {
            clearTimeout(this.geolocationTimeout);
        }

        const locationBtn = document.getElementById('get-location');
        const originalText = locationBtn.textContent;
        
        locationBtn.textContent = '⏳ Отримання...';
        locationBtn.disabled = true;

        this.showToast('🌍 Визначення місця розташування...');

        // Таймаут для геолокації
        this.geolocationTimeout = setTimeout(() => {
            this.showToast('⏰ Час очікування геолокації вийшов. Спробуйте ще раз або введіть місце вручну.');
            locationBtn.textContent = originalText;
            locationBtn.disabled = false;
            this.enableManualLocation();
        }, 15000);

        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    resolve,
                    reject,
                    {
                        enableHighAccuracy: false,
                        timeout: 10000,
                        maximumAge: 5 * 60 * 1000
                    }
                );
            });

            clearTimeout(this.geolocationTimeout);

            const { latitude, longitude } = position.coords;
            
            // Використовуємо координати як fallback
            document.getElementById('location').value = `Координати: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            
            // Спроба отримати адресу (неблокуюча)
            try {
                const address = await this.getAddressFromCoords(latitude, longitude);
                if (address && !address.includes('Помилка')) {
                    document.getElementById('location').value = address;
                }
            } catch (addressError) {
                console.log('Адресу не отримано, використовуємо координати');
            }

            this.showToast('✅ Місце розташування отримано!');
            
        } catch (error) {
            clearTimeout(this.geolocationTimeout);
            console.error('Помилка геолокації:', error);
            
            let errorMessage = '❌ Не вдалося отримати місце розташування';
            
            if (error.code === error.PERMISSION_DENIED) {
                errorMessage = '❌ Доступ до геолокації заборонено. Дозвольте доступ у налаштуваннях браузера.';
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                errorMessage = '❌ Інформація про місце розташування недоступна';
            } else if (error.code === error.TIMEOUT) {
                errorMessage = '⏰ Час очікування вийшов. Спробуйте ще раз або введіть місце вручну.';
            }
            
            this.showToast(errorMessage);
            this.enableManualLocation();
        } finally {
            locationBtn.textContent = '📍 Отримати моє місце';
            locationBtn.disabled = false;
        }
    }

    enableManualLocation() {
        const locationInput = document.getElementById('location');
        locationInput.readOnly = false;
        locationInput.placeholder = 'Введіть місце вручну (наприклад: "Карпати, гора Говерla")';
        document.getElementById('manual-location').classList.remove('hidden');
        this.showToast('💡 Можете ввести місце вручну');
    }

    saveManualLocation() {
        const locationInput = document.getElementById('location');
        if (locationInput.value.trim()) {
            locationInput.readOnly = true;
            document.getElementById('manual-location').classList.add('hidden');
            this.showToast('✅ Місце збережено');
        } else {
            this.showToast('❌ Будь ласка, введіть місце');
        }
    }

    async getAddressFromCoords(lat, lng) {
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
                {
                    headers: {
                        'Accept-Language': 'uk,en-US;q=0.7,en;q=0.3'
                    },
                    signal: AbortSignal.timeout(5000)
                }
            );
            
            if (!response.ok) throw new Error('Помилка отримання адреси');
            
            const data = await response.json();
            return data.display_name || `Координати: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        } catch (error) {
            console.log('Не вдалося отримати адресу:', error);
            return `Координати: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        }
    }

    async loadEntries() {
        try {
            // Спочатку намагаємося завантажити з сервера
            if (this.isOnline) {
                try {
                    const response = await fetch('/api/entries');
                    if (response.ok) {
                        const serverEntries = await response.json();
                        
                        // Оновлюємо локальну базу
                        const tx = this.db.transaction('entries', 'readwrite');
                        for (const entry of serverEntries) {
                            await tx.store.put({ ...entry, synced: true });
                        }
                        await tx.done;
                        
                        return serverEntries;
                    }
                } catch (serverError) {
                    console.log('Помилка завантаження з сервера:', serverError);
                }
            }
            
            // Якщо сервер недоступний - завантажуємо з локальної бази
            const tx = this.db.transaction('entries', 'readonly');
            return await tx.store.getAll();
            
        } catch (error) {
            console.error('Помилка завантаження записів:', error);
            return [];
        }
    }

    async checkSync() {
        if (this.isOnline) {
            try {
                // Перевіряємо чергу синхронізації
                const tx = this.db.transaction('syncQueue', 'readonly');
                const queue = await tx.store.getAll();
                await tx.done;

                if (queue.length > 0) {
                    this.showToast('🔄 Синхронізація даних...');
                    await this.syncData(queue);
                }
            } catch (error) {
                console.error('Помилка синхронізації:', error);
            }
        }
    }

    async syncData(queue) {
        try {
            const entriesToSync = queue.map(item => item.data);
            
            const response = await fetch('/api/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ entries: entriesToSync })
            });

            if (response.ok) {
                // Очищаємо чергу
                const tx = this.db.transaction('syncQueue', 'readwrite');
                await tx.store.clear();
                await tx.done;
                
                // Оновлюємо статус синхронізації в записах
                const entriesTx = this.db.transaction('entries', 'readwrite');
                const entries = await entriesTx.store.getAll();
                
                for (const entry of entries) {
                    if (!entry.synced) {
                        entry.synced = true;
                        await entriesTx.store.put(entry);
                    }
                }
                await entriesTx.done;
                
                this.showToast('✅ Дані синхронізовано!');
            }
        } catch (error) {
            console.error('Помилка синхронізації:', error);
            this.showToast('❌ Помилка синхронізації. Спробуйте пізніше.');
        }
    }

    async displayEntries() {
        const container = document.getElementById('entries-container');
        
        try {
            const entries = await this.loadEntries();
            
            if (entries.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <h3>📝 Ще немає записів</h3>
                        <p>Додайте ваш перший запис про подорож!</p>
                    </div>
                `;
                return;
            }

            // Сортуємо за датою (новіші першими)
            entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            container.innerHTML = entries.map(entry => `
                <div class="entry-card">
                    <h3>${this.escapeHtml(entry.title)}</h3>
                    <div class="date">📅 ${entry.date} ${!entry.synced ? '🔄' : ''}</div>
                    ${entry.description ? `<div class="description">${this.escapeHtml(entry.description)}</div>` : ''}
                    ${entry.location ? `<div class="location">📍 ${this.escapeHtml(entry.location)}</div>` : ''}
                    ${entry.photo ? `<img src="${entry.photo}" class="entry-image" alt="${this.escapeHtml(entry.title)}">` : ''}
                    ${!entry.synced ? '<div class="sync-status">⏳ Очікує синхронізації</div>' : ''}
                </div>
            `).join('');
        } catch (error) {
            console.error('Помилка відображення записів:', error);
            container.innerHTML = '<p class="error">❌ Помилка завантаження записів</p>';
        }
    }

    resetForm() {
        document.getElementById('entry-form').reset();
        document.getElementById('photo-preview').innerHTML = '';
        this.currentPhoto = null;
        document.getElementById('location').readOnly = true;
        document.getElementById('location').placeholder = 'Натисніть кнопку для отримання місця';
        document.getElementById('manual-location').classList.add('hidden');
    }

    async generatePDF() {
        try {
            const entries = await this.loadEntries();
            
            if (entries.length === 0) {
                this.showToast('📝 Немає записів для генерації звіту');
                return;
            }

            this.showToast('🔄 Генерація PDF...');

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            // Заголовок
            doc.setFontSize(20);
            doc.setTextColor(46, 125, 50);
            doc.text('Звіт про подорожі', 105, 20, { align: 'center' });
            
            doc.setFontSize(12);
            doc.setTextColor(100, 100, 100);
            doc.text(`Згенеровано: ${new Date().toLocaleDateString('uk-UA')}`, 105, 30, { align: 'center' });
            
            let y = 40;
            
            entries.forEach((entry, index) => {
                if (y > 250) {
                    doc.addPage();
                    y = 20;
                }
                
                doc.setFontSize(16);
                doc.setTextColor(0, 0, 0);
                doc.text(entry.title, 20, y);
                y += 10;
                
                doc.setFontSize(10);
                doc.setTextColor(100, 100, 100);
                doc.text(entry.date, 20, y);
                y += 8;
                
                if (entry.description) {
                    doc.setFontSize(12);
                    doc.setTextColor(0, 0, 0);
                    const splitText = doc.splitTextToSize(entry.description, 170);
                    doc.text(splitText, 20, y);
                    y += splitText.length * 6;
                }
                
                if (entry.location) {
                    doc.setFontSize(10);
                    doc.setTextColor(76, 175, 80);
                    doc.text(`📍 ${entry.location}`, 20, y);
                    y += 8;
                }
                
                y += 15;
                
                if (index < entries.length - 1) {
                    doc.setDrawColor(200, 200, 200);
                    doc.line(20, y, 190, y);
                    y += 10;
                }
            });
            
            doc.save(`звіт_подорожі_${new Date().toISOString().split('T')[0]}.pdf`);
            this.showToast('✅ PDF успішно згенеровано!');
        } catch (error) {
            console.error('Помилка генерації PDF:', error);
            this.showToast('❌ Помилка при генерації PDF');
        }
    }

    async clearAllData() {
        if (!confirm('Ви впевнені, що хочете видалити всі записи? Цю дію не можна скасувати.')) {
            return;
        }

        try {
            const tx = this.db.transaction('entries', 'readwrite');
            await tx.store.clear();
            await tx.done;
            
            const syncTx = this.db.transaction('syncQueue', 'readwrite');
            await syncTx.store.clear();
            await syncTx.done;
            
            this.showToast('✅ Всі дані видалено');
            await this.displayEntries();
        } catch (error) {
            console.error('Помилка очищення даних:', error);
            this.showToast('❌ Помилка при видаленні даних');
        }
    }

    async clearPWACache() {
        if (!confirm('Очистити кеш PWA? Це оновить дизайн додатка.')) {
            return;
        }

        try {
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (let registration of registrations) {
                    await registration.unregister();
                }
            }
            
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                for (let cacheName of cacheNames) {
                    await caches.delete(cacheName);
                }
            }
            
            // Очищаємо IndexedDB
            await this.db.close();
            indexedDB.deleteDatabase('TravelDiaryDB');
            
            this.showToast('✅ Кеш PWA очищено! Оновіть сторінку.');
            setTimeout(() => {
                window.location.reload();
            }, 2000);
            
        } catch (error) {
            console.error('Помилка очищення кешу:', error);
            this.showToast('❌ Помилка при очищенні кешу');
        }
    }

    handleInstallPrompt(e) {
        e.preventDefault();
        this.deferredPrompt = e;
        document.getElementById('install-btn').classList.remove('hidden');
    }

    async installApp() {
        if (!this.deferredPrompt) {
            this.showToast('Додаток вже встановлено або не підтримує встановлення');
            return;
        }
        
        this.deferredPrompt.prompt();
        
        const { outcome } = await this.deferredPrompt.userChoice;
        
        if (outcome === 'accepted') {
            this.showToast('✅ Додаток встановлено!');
        } else {
            this.showToast('❌ Встановлення скасовано');
        }
        
        this.deferredPrompt = null;
        document.getElementById('install-btn').classList.add('hidden');
    }

    checkOnlineStatus() {
        this.isOnline = navigator.onLine;
        
        const statusElement = document.createElement('div');
        statusElement.className = `status ${this.isOnline ? 'online' : 'offline'}`;
        statusElement.textContent = this.isOnline ? '🌐 Онлайн' : '📴 Офлайн';
        document.body.appendChild(statusElement);

        setTimeout(() => {
            if (document.body.contains(statusElement)) {
                document.body.removeChild(statusElement);
            }
        }, 3000);

        if (this.isOnline) {
            this.handleOnlineStatus();
        } else {
            this.handleOfflineStatus();
        }
    }

    handleOnlineStatus() {
        this.showToast('🌐 Ви онлайн. Синхронізація даних...', 2000);
        this.scheduleNotifications();
        this.checkSync();
    }

    handleOfflineStatus() {
        this.showToast('📴 Ви офлайн. Дані будуть синхронізовані при підключенні.', 3000);
    }

    scheduleNotifications() {
        // Сповіщення про фото дня
        setTimeout(() => {
            this.showBrowserNotification('Не забудьте зробити фото дня! 📸');
        }, 30000); // 30 секунд для демонстрації

        // Перевірка минулих подорожей
        this.checkPastTrips();
    }

    async checkPastTrips() {
        const entries = await this.loadEntries();
        if (entries.length > 0) {
            const firstEntry = entries[0];
            const entryDate = new Date(firstEntry.timestamp);
            const now = new Date();
            
            const diffTime = Math.abs(now - entryDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays === 365) {
                this.showBrowserNotification(`🎂 Рік тому ви були в подорожі: "${firstEntry.title}"`);
            } else if (diffDays === 30) {
                this.showBrowserNotification(`📅 Місяць тому ви були в подорожі: "${firstEntry.title}"`);
            }
        }
    }

    showBrowserNotification(message) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Щоденник подорожей', {
                body: message,
                icon: 'icons/icon-192.png',
                badge: 'icons/icon-192.png'
            });
        }
    }

    async requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            try {
                const permission = await Notification.requestPermission();
                console.log('Дозвіл на сповіщення:', permission);
            } catch (error) {
                console.error('Помилка запиту дозволу:', error);
            }
        }
    }

    showToast(message, duration = 3000) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.remove('hidden');
        
        setTimeout(() => {
            toast.classList.add('hidden');
        }, duration);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async setupServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/service-worker.js?v=4');
                console.log('Service Worker зареєстровано:', registration);
                
                // Слухаємо оновлення
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            this.showToast('🔄 Доступне оновлення! Оновіть сторінку.');
                        }
                    });
                });
                
            } catch (error) {
                console.error('Помилка реєстрації Service Worker:', error);
            }
        }
    }
}

// Ініціалізація додатку
document.addEventListener('DOMContentLoaded', () => {
    window.travelDiaryApp = new TravelDiary();
});

// Глобальна функція для оновлення
window.updatePWA = function() {
    if (window.travelDiaryApp) {
        window.travelDiaryApp.clearPWACache();
    }
};

// Обробка помилок
window.addEventListener('error', (event) => {
    console.error('Глобальна помилка:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Необроблена проміс-помилка:', event.reason);
});