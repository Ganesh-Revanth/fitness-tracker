import { auth } from "./firebase.js";
import { signInWithEmailAndPassword }   from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

const form = document.getElementById("login-form");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    try{
        const userCredential = await signInWithEmailAndPassword(auth, email, password);

        console.log("Logged in:", userCredential.user);

        window.location.href = "dashboard.html";
    } catch (error) {
        alert(error.message);
        console.error(error);
    }
    
});