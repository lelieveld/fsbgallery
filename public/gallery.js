(function () {
  const thumbnails = Array.from(document.querySelectorAll(".thumbnail-button"));
  const lightbox = document.getElementById("lightbox");
  const image = document.getElementById("lightbox-image");
  const title = document.getElementById("lightbox-title");
  const download = document.getElementById("lightbox-download");
  const closeButton = document.querySelector(".lightbox-close");
  const prevButton = document.querySelector(".lightbox-prev");
  const nextButton = document.querySelector(".lightbox-next");
  let currentIndex = 0;

  if (!lightbox || thumbnails.length === 0) return;

  function show(index) {
    currentIndex = (index + thumbnails.length) % thumbnails.length;
    const button = thumbnails[currentIndex];

    image.src = button.dataset.src;
    image.alt = button.dataset.name || "Foto";
    title.textContent = button.dataset.name || "";
    download.href = button.dataset.download || "#";
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
  }

  function close() {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    image.src = "";
  }

  thumbnails.forEach((button, index) => {
    button.addEventListener("click", () => show(index));
  });

  closeButton.addEventListener("click", close);
  prevButton.addEventListener("click", () => show(currentIndex - 1));
  nextButton.addEventListener("click", () => show(currentIndex + 1));

  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) close();
  });

  document.addEventListener("keydown", (event) => {
    if (!lightbox.classList.contains("is-open")) return;
    if (event.key === "Escape") close();
    if (event.key === "ArrowLeft") show(currentIndex - 1);
    if (event.key === "ArrowRight") show(currentIndex + 1);
  });
})();
