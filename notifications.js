const notification = document.createElement("div");
notification.id = "notification";
document.body.appendChild(notification);

export function notify(message) {
    notification.textContent = message;

    notification.classList.remove("show");
    void notification.offsetWidth;
    notification.classList.add("show");
}