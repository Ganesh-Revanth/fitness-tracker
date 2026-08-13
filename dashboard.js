import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut, sendEmailVerification }   from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { doc, getDoc }  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { notify } from "./notifications.js";

const message = sessionStorage.getItem("notification");
if(message) {
    notify(message);
    sessionStorage.removeItem("notification");
}
onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    // block access for unverified email addresses
    if (!user.emailVerified) {
        try {
            await sendEmailVerification(user);
        } catch (e) {
            console.warn('Failed to send verification email on dashboard access', e);
        }
        await signOut(auth);
        sessionStorage.setItem('notification', 'Please verify your email before accessing the dashboard. A verification link was sent.');
        window.location.href = 'login.html';
        return;
    }

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if(userSnap.exists()) {
        const data = userSnap.data();

        document.getElementById("username").textContent = data.firstName;
        // Populate welcome card fields if present
        try {
            const fullNameEl = document.getElementById('user-fullname');
            const memberSinceEl = document.getElementById('member-since');
            const workoutsCountEl = document.getElementById('workouts-count');
            const caloriesEl = document.getElementById('calories-today');

            if (fullNameEl) fullNameEl.textContent = `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.firstName || 'Welcome';

            if (memberSinceEl) {
                const created = data.createdAt;
                let dateStr = '-';
                if (created && typeof created.toDate === 'function') {
                    dateStr = created.toDate().toLocaleDateString();
                } else if (created) {
                    const d = new Date(created);
                    if (!isNaN(d)) dateStr = d.toLocaleDateString();
                }
                memberSinceEl.textContent = dateStr;
            }

            if (workoutsCountEl) {
                const workouts = data.workouts;
                if (Array.isArray(workouts)) workoutsCountEl.textContent = workouts.length;
                else if (typeof data.workoutsCount === 'number') workoutsCountEl.textContent = data.workoutsCount;
                else workoutsCountEl.textContent = '0';
            }

            if (caloriesEl) {
                caloriesEl.textContent = data.caloriesToday || data.todayCalories || (data.stats && data.stats.caloriesToday) || '—';
            }
        } catch (e) {
            console.warn('Welcome card population error', e);
        }
    }
});

// Sidebar is now controlled by CSS hover (expand on hover); no JS toggle required.