const track = document.querySelector('.carousel-track');
const slides = [...track.querySelectorAll('.slide')];
const dots = [...document.querySelectorAll('.dots button')];
const status = document.querySelector('.slide-status');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let activeIndex = 0;
let scrollTimer;

document.querySelector('.carousel-controls').hidden = false;

function showSlide(index) {
  activeIndex = (index + slides.length) % slides.length;
  const slide = slides[activeIndex];
  track.scrollTo({
    left: slide.offsetLeft - track.offsetLeft - (track.clientWidth - slide.clientWidth) / 2,
    behavior: reducedMotion.matches ? 'instant' : 'smooth',
  });
}

function updateSelection() {
  const trackBounds = track.getBoundingClientRect();
  const center = trackBounds.left + trackBounds.width / 2;
  let nearestDistance = Infinity;
  slides.forEach((slide, index) => {
    const bounds = slide.getBoundingClientRect();
    const distance = Math.abs(bounds.left + bounds.width / 2 - center);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      activeIndex = index;
    }
  });
  dots.forEach((dot, index) => dot.setAttribute('aria-current', String(index === activeIndex)));
  status.textContent = `${activeIndex + 1} / ${slides.length} — ${slides[activeIndex].querySelector('figcaption').textContent}`;
}

document.querySelector('.previous').addEventListener('click', () => showSlide(activeIndex - 1));
document.querySelector('.next').addEventListener('click', () => showSlide(activeIndex + 1));
dots.forEach((dot, index) => dot.addEventListener('click', () => showSlide(index)));
track.addEventListener('keydown', (event) => {
  if (event.target !== track) return;
  const destinations = { ArrowLeft: activeIndex - 1, ArrowRight: activeIndex + 1, Home: 0, End: slides.length - 1 };
  if (event.key in destinations) {
    event.preventDefault();
    showSlide(destinations[event.key]);
  }
});
track.addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(updateSelection, 120);
}, { passive: true });
window.addEventListener('resize', updateSelection);

// Keep the large opening video playing while visible; play only visible demonstrations.
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const video = entry.target;
    const visibilityThreshold = video.id === 'hero-video' ? 0.05 : 0.6;
    if (entry.intersectionRatio >= visibilityThreshold && !document.hidden && !reducedMotion.matches) {
      video.play().catch(() => {}); // Native controls remain available if autoplay is blocked.
    } else {
      video.pause();
    }
  }
}, { threshold: [0.05, 0.6] });
const videos = [...document.querySelectorAll('video')];
videos.forEach((video) => {
  if (reducedMotion.matches) {
    video.autoplay = false;
    video.pause();
  }
  observer.observe(video);
});
document.addEventListener('visibilitychange', () => {
  videos.forEach((video) => {
    if (document.hidden) video.pause();
    else {
      observer.unobserve(video);
      observer.observe(video);
    }
  });
});
