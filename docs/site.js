const dialog = document.querySelector('#release-dialog');
let trigger;

document.querySelectorAll('[data-browser]').forEach(button => {
  button.addEventListener('click', () => {
    trigger = button;
    dialog.showModal();
  });
});

document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => trigger?.focus());

const testimonials = document.querySelector('.testimonials-section');
const testimonialCopy = testimonials.querySelector('.testimonial-set').cloneNode(true);
testimonialCopy.setAttribute('aria-hidden', 'true');
testimonialCopy.inert = true;
testimonials.querySelector('.testimonials-track').append(testimonialCopy);

const testimonialViewport = testimonials.querySelector('.testimonials-viewport');
const testimonialTrack = testimonials.querySelector('.testimonials-track');
const testimonialSet = testimonials.querySelector('.testimonial-set');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let browsingTestimonials = false;

function browseTestimonials() {
  if (browsingTestimonials || reducedMotion.matches) return;
  const transform = getComputedStyle(testimonialTrack).transform;
  const offset = transform === 'none' ? 0 : -new DOMMatrixReadOnly(transform).m41;
  // Transfer the animation's position to native scrolling without a visible jump.
  testimonialTrack.style.animationName = 'none';
  testimonialViewport.scrollLeft = offset;
  browsingTestimonials = true;
}

function resumeTestimonials() {
  if (!browsingTestimonials || testimonialViewport.matches(':hover, :focus-within')) return;
  const progress = testimonialViewport.scrollLeft % testimonialSet.offsetWidth / testimonialSet.offsetWidth;
  const duration = parseFloat(getComputedStyle(testimonialTrack).animationDuration);
  testimonialViewport.scrollLeft = 0;
  testimonialTrack.style.animationDelay = `-${progress * duration}s`;
  testimonialTrack.style.animationName = '';
  browsingTestimonials = false;
}

testimonialViewport.addEventListener('pointerenter', browseTestimonials);
testimonialViewport.addEventListener('pointerleave', resumeTestimonials);
testimonialViewport.addEventListener('focusin', browseTestimonials);
testimonialViewport.addEventListener('focusout', () => queueMicrotask(resumeTestimonials));

