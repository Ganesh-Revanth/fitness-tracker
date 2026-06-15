import { auth } from "./firebase.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const loginBtn = document.getElementById('login-btn');

loginBtn.addEventListener('click', (e) => {
    e.preventDefault();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    signInWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            alert("Logged in successfully!");
            window.location.href = "index.html";
        })
        .catch((error) => {
            alert("Login failed: " + error.message);
        });
});