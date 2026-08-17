import { auth } from "./firebase.js";
import { notify } from "./notifications.js";

document.querySelectorAll(".nav-links a").forEach((link) => {
    link.addEventListener("click", (e) => {
        if(!auth.currentUser) {
            e.preventDefault();
            notify(`Please log in to access ${link.textContent.trim()}.`);
            setTimeout( () => {
                window.location.href = "login.html";
            }, 1200);
        }    
    });
});