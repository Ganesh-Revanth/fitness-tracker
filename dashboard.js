import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut, sendEmailVerification }   from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { doc, getDoc, onSnapshot, setDoc }  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
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

    // If trackers data is missing, initialize with safe defaults
    const initialTrackers = {
        weight: { current: null, change: null, history: [] },
        calories: { today: null, target: 2000 },
        water: { today: null, target: 3 },
        streak: { current: 0, best: 0 }
    };
    if (!userSnap.exists()) {
        await setDoc(userRef, { trackers: initialTrackers }, { merge: true });
    } else {
        const dataNow = userSnap.data();
        if (!dataNow.trackers) {
            await setDoc(userRef, { trackers: initialTrackers }, { merge: true });
        }
    }

    // Listen for realtime updates to user document to update trackers live
    onSnapshot(userRef, (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const trackers = d.trackers || d.stats || {};

        // weight
        const weightVal = trackers.weight && trackers.weight.current ? `${trackers.weight.current}` : '—';
        const weightChange = trackers.weight && trackers.weight.change ? trackers.weight.change : '';
        const weightEl = document.getElementById('weight-value');
        const weightChangeEl = document.getElementById('weight-change');
        if (weightEl) weightEl.textContent = weightVal === '—' ? '— kg' : `${weightVal} kg`;
        if (weightChangeEl) weightChangeEl.textContent = weightChange ? `${weightChange}` : '';

        // calories
        const calToday = trackers.calories && trackers.calories.today ? trackers.calories.today : 0;
        const calTarget = trackers.calories && trackers.calories.target ? trackers.calories.target : 2000;
        const calPct = calTarget ? Math.min(100, Math.round((calToday / calTarget) * 100)) : 0;
        const calValEl = document.getElementById('calories-value');
        const calTargetEl = document.getElementById('calories-target');
        const calBar = document.getElementById('calories-progress');
        if (calValEl) calValEl.textContent = calToday || '—';
        if (calTargetEl) calTargetEl.textContent = calTarget || '—';
        if (calBar) calBar.style.width = `${calPct}%`;

        // water
        const waterToday = trackers.water && trackers.water.today ? trackers.water.today : 0;
        const waterTarget = trackers.water && trackers.water.target ? trackers.water.target : 3;
        const waterValEl = document.getElementById('water-value');
        const waterTargetEl = document.getElementById('water-target');
        const waterDropsEl = document.getElementById('water-drops');
        if (waterValEl) waterValEl.textContent = waterToday || '—';
        if (waterTargetEl) waterTargetEl.textContent = waterTarget || '—';
        if (waterDropsEl) {
            waterDropsEl.innerHTML = '';
            const total = 4; // show 4 drops
            const filled = Math.round((waterToday / waterTarget) * total);
            for (let i=0;i<total;i++){
                const span = document.createElement('span');
                span.className = 'drop' + (i < filled ? ' full' : '');
                span.textContent = '💧';
                waterDropsEl.appendChild(span);
            }
        }

        // streak
        const streakCur = trackers.streak && typeof trackers.streak.current === 'number' ? trackers.streak.current : 0;
        const streakBest = trackers.streak && typeof trackers.streak.best === 'number' ? trackers.streak.best : 0;
        const streakEl = document.getElementById('streak-value');
        const streakBestEl = document.getElementById('streak-best');
        if (streakEl) streakEl.textContent = `${streakCur} Days`;
        if (streakBestEl) streakBestEl.textContent = `Best: ${streakBest} Days`;
    });

    if(userSnap.exists()) {
        const data = userSnap.data();

        document.getElementById("username").textContent = data.firstName;
        // Populate welcome card fields if present
        try {
            const greetingEl = document.getElementById('greeting');
            const memberSinceEl = document.getElementById('member-since');
            const workoutsCountEl = document.getElementById('workouts-count');
            const caloriesEl = document.getElementById('calories-today');
            const quoteEl = document.getElementById('welcome-quote');

            const name = data.firstName || data.displayName || (data.email ? data.email.split('@')[0] : '');

            // time-based greeting
            function timeGreeting() {
                const h = new Date().getHours();
                if (h >= 5 && h < 12) return 'Good morning';
                if (h >= 12 && h < 17) return 'Good afternoon';
                if (h >= 17 && h < 22) return 'Good evening';
                return 'Hello';
            }

            if (greetingEl) greetingEl.textContent = `${timeGreeting()} ${name ? name : ''}`.trim();

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

            // rotating quotes
            const QUOTES = [
                'Small steps every day build lasting habits.',
                'Consistency beats intensity — do a little more each day.',
                'Progress is better than perfection.',
                'Rest is part of growth — recover well.',
                'Keep your head up and your heart strong.'
            ];
            if (quoteEl) {
                let index = Math.floor(Math.random() * QUOTES.length);
                quoteEl.textContent = `"${QUOTES[index]}"`;
                setInterval(() => {
                    index = (index + 1) % QUOTES.length;
                    quoteEl.textContent = `"${QUOTES[index]}"`;
                }, 6000);
            }

        } catch (e) {
            console.warn('Welcome card population error', e);
        }
    }
});

// Sidebar is now controlled by CSS hover (expand on hover); no JS toggle required.