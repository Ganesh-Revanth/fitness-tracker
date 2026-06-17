import { auth } from "./firebase.js";
import { signInWithEmailAndPassword }   from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { notify } from "./notifications.js";

const form = document.getElementById("login-form");

const message = sessionStorage.getItem("notification");
if(message) {
    notify(message);
    sessionStorage.removeItem("notification");
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    try{
        const userCredential = await signInWithEmailAndPassword(auth, email, password);

        sessionStorage.setItem(
            "notification",
            "Logged in Successfully!"
        );
        console.log("Logged in:", userCredential.user);

        window.location.href = "dashboard.html";
    } catch (error) {
        notify(error.message);
        console(error.message);
        console.error(error);
    }
    
});