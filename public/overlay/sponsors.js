// Sponsor-only overlay — lightweight, separate OBS browser source
let overlayDesigns = {};

function connectSSE() {
  window.AtletaSSE.connect({
    url: `/overlay/sponsors/events/${window.OVERLAY_TOKEN}`,
    onMessage: (data) => {
      if (data.type === 'config') {
        if (data.designs) overlayDesigns = data.designs;
        return;
      }

      if (data.type === 'config-update') {
        if (data.designs) overlayDesigns = data.designs;
        return;
      }

      if (data.type === 'sponsor') {
        showSponsorImage(data.data);
      }
    },
  });
}

connectSSE();

function showSponsorImage(data) {
  // Remove existing banners
  document.querySelectorAll('.sponsor-banner').forEach(el => el.remove());

  const design = overlayDesigns['timed'];
  const sponsorAnim = (design && design.sponsor_animation) || 'fade';

  const banner = document.createElement('div');
  banner.className = 'sponsor-banner anim-' + sponsorAnim;

  // Size — fill the OBS source, let OBS handle positioning/scaling
  banner.style.width = '100%';
  banner.style.height = '100%';
  banner.style.display = 'flex';
  banner.style.alignItems = 'center';
  banner.style.justifyContent = 'center';
  banner.style.position = 'fixed';
  banner.style.inset = '0';

  const img = document.createElement('img');
  img.src = data.imageUrl;
  img.alt = data.name || 'Sponsor';
  img.style.display = 'block';
  img.style.maxWidth = '100%';
  img.style.maxHeight = '100%';
  img.style.objectFit = 'contain';

  const imgScale = data.imageScale != null ? data.imageScale : 1.0;
  if (imgScale < 1) {
    img.style.maxWidth = (imgScale * 100) + '%';
    img.style.maxHeight = (imgScale * 100) + '%';
  }

  banner.appendChild(img);
  document.getElementById('timed-container').appendChild(banner);

  // Auto-hide before next image
  if (data.displayDuration) {
    const hideAfter = Math.max(2000, (data.displayDuration * 1000) - 2000);
    setTimeout(() => {
      banner.classList.add('dismissing');
      setTimeout(() => banner.remove(), 400);
    }, hideAfter);
  }
}
