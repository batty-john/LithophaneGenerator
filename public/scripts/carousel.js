document.addEventListener('DOMContentLoaded', function() {
    const carousel = document.querySelector('.carousel');
    const images = document.querySelectorAll('.carousel img');
    const totalImages = images.length;
    let currentIndex = 0;
    let interval;

    function updateCarousel() {
        carousel.style.transform = `translateX(-${currentIndex * 100}%)`;
    }

    function nextImage() {
        currentIndex = (currentIndex + 1) % totalImages;
        updateCarousel();
    }

    function prevImage() {
        currentIndex = (currentIndex - 1 + totalImages) % totalImages;
        updateCarousel();
    }

    function startInterval() {
        interval = setInterval(nextImage, 3000);
    }

    function stopInterval() {
        clearInterval(interval);
    }

    // Initialize carousel
    updateCarousel();
    startInterval();

    // Add event listeners for manual controls
    carousel.addEventListener('click', function(event) {
        stopInterval();
        if (event.clientX < window.innerWidth / 2) {
            prevImage();
        } else {
            nextImage();
        }
        startInterval();
    });
});



