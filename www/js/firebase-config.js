// js/firebase-config.js

const firebaseConfig = {
    apiKey: "AIzaSyBOvXIJNRKYSMqdy7V92KVKrH6H320G0hw",
    authDomain: "ramblers-academy-official.firebaseapp.com",
    projectId: "ramblers-academy-official",
    storageBucket: "ramblers-academy-official.firebasestorage.app",
    messagingSenderId: "39544664685",
    appId: "1:39544664685:web:05f65d42d2cc7a55704564",
    measurementId: "G-5ZQYELY7CM"
};

// Initialize Firebase using the Compat CDN method
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Attach explicitly to window so all other scripts can use them
window.auth = firebase.auth();
window.db = firebase.firestore();