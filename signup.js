import { auth } from "./firebase.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const signupBtn = document.getElementById('signup-btn');

signupBtn.addEventListener('click', (e) => {
    e.preventDefault(); // Stop the form from refreshing the page

    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;

    createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            alert("Account Created!");
            window.location.href = "index.html"; // Redirect to dashboard
        })
        .catch((error) => {
            alert(error.message); // Shows if password is too short or email is taken
        });
});