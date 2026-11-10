// Track clicks
document.addEventListener('click', function (e) {
    const adLink = e.target.closest('.xp-ad-click');
    if (adLink) {
        const wrapper = adLink.closest('[data-xp-ad-id]');
        if (!wrapper) return;

        const adId = wrapper.dataset.xpAdId;
        if (wrapper.dataset.clicked === "1") return;
        wrapper.dataset.clicked = "1";

        fetch(`/wp-admin/admin-ajax.php?action=xp_track_ad_click&ad_id=${adId}`);
    }
});

// Track views
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting && !entry.target.dataset.viewed) {
            entry.target.dataset.viewed = "1";
            const adId = entry.target.dataset.xpAdId;

            fetch(`/wp-admin/admin-ajax.php?action=xp_track_ad_view&ad_id=${adId}`);
        }
    });
}, { threshold: 0.5 });

document.querySelectorAll('[data-xp-ad-id]').forEach(el => observer.observe(el));
