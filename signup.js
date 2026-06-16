import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const form = document.getElementById("signup-form");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const firstName = document.getElementById("firstName").value.trim();
    const lastName = document.getElementById("lastName").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;
    const birthdate = document.getElementById("birthdate").value;
    const gender = document.getElementById("signup-gender").value;
    const weight = Number(document.getElementById("weight").value);
    const height = Number(document.getElementById("height").value);

    console.log("Signup button clicked");
    
    try{
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await setDoc(doc(db, "users", user.uid), {
            firstName,
            lastName,
            email,
            birthdate,
            gender,
            weight,
            height,
            createdAt: Date.now()
        });

        window.location.href = "dashboard.html";
    } catch (error) {
        alert(error.message);
    }
});