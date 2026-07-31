import { auth, db } from "./firebase.js";
import { onAuthStateChanged }   from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { doc, getDoc }  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { notify } from "./notifications.js";

const message = sessionStorage.getItem("notification");
if(message) {
    notify(message);
    sessionStorage.removeItem("notification");
}
onAuthStateChanged(auth, async (user) => {

    if(!user) {
        window.location.href = "login.html";
        return;
    }

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if(userSnap.exists()) {
        const data = userSnap.data();

        document.getElementById("username").textContent = data.firstName;
    }
});

const toggleButton = document.getElementById('toggle-btn')
const sidebar = document.getElementById('sidebar')

toggleButton.addEventListener("click", toggleSidebar);  

function toggleSidebar(){
    sidebar.classList.toggle('close')
    if (sidebar.classList.contains("close")) {
        toggleButton.textContent = ">>";
    } else {
        toggleButton.textContent = "Collapse Menu <<";
    }
}