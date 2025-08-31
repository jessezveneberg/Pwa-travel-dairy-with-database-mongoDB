const dbPromise = idb.openDB('travel-diary', 1, {
  upgrade(db) {
    db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
    db.createObjectStore('sync-queue', { keyPath: 'id' });
  }
});

// Додавання запису
async function addEntry(entry) {
  const db = await dbPromise;
  const tx = db.transaction('entries', 'readwrite');
  await tx.store.add(entry);
  await tx.done;
  
  // Додаємо до черги синхронізації
  const syncTx = db.transaction('sync-queue', 'readwrite');
  await syncTx.store.add({
    type: 'add-entry',
    data: entry,
    timestamp: Date.now()
  });
  await syncTx.done;
}

// Отримання всіх записів
async function getAllEntries() {
  const db = await dbPromise;
  const tx = db.transaction('entries', 'readonly');
  const entries = await tx.store.getAll();
  await tx.done;
  return entries;
}

// Отримання геолокації
function getLocation() {
  return new Promise((resolve, reject) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        }),
        error => reject(error)
      );
    } else {
      reject(new Error('Geolocation is not supported'));
    }
  });
}

// Генерація PDF
async function generatePdfReport(entries) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  doc.setFontSize(18);
  doc.text('Звіт про подорожі', 10, 10);
  doc.setFontSize(12);
  
  let y = 20;
  entries.forEach((entry, index) => {
    doc.setFontSize(14);
    doc.text(`${entry.date}: ${entry.title}`, 10, y);
    doc.setFontSize(12);
    
    const descriptionLines = doc.splitTextToSize(entry.description, 180);
    doc.text(descriptionLines, 10, y + 10);
    
    if (entry.location) {
      doc.text(`Місце: ${entry.location}`, 10, y + 10 + (descriptionLines.length * 7));
    }
    
    if (entry.photo) {
      try {
        const img = new Image();
        img.src = entry.photo;
        doc.addImage(img, 'JPEG', 10, y + 20 + (descriptionLines.length * 7), 50, 50);
        y += 80 + (descriptionLines.length * 7);
      } catch (error) {
        console.error('Помилка при додаванні зображення:', error);
        y += 20 + (descriptionLines.length * 7);
      }
    } else {
      y += 20 + (descriptionLines.length * 7);
    }
    
    if (index < entries.length - 1) doc.addPage();
    y = 20;
  });
  
  return doc.output('blob');
}

// Експорт функцій
window.dbFunctions = {
  addEntry,
  getAllEntries,
  getLocation,
  generatePdfReport
};