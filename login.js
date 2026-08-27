import { auth } from "./firebase.js";
import { signInWithEmailAndPassword, sendEmailVerification, signOut }   from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { notify } from "./notifications.js";

document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
});

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
        const user = userCredential.user;

        if (!user.emailVerified) {
            // resend verification and sign out
            try {
                await sendEmailVerification(user);
            } catch (e) {
                console.warn('sendEmailVerification failed', e);
            }
            await signOut(auth);
            const msg = "Verify your email to login";
            // immediate feedback
            try { notify(msg); } catch (e) { console.warn('notify failed', e); }
            // persist for next load
            sessionStorage.setItem("notification", msg);
            return;
        }

        sessionStorage.setItem("notification", "Logged in Successfully!");
        console.log("Logged in:", user);
        window.location.href = "dashboard.html";
    } catch (error) {
        notify(error.message);
        console.log(error.message);
        console.error(error);
    }
    
});