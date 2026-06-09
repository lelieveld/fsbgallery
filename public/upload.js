const uploadForm = document.querySelector('form[action="/submit-photos"]');
const uploadInput = document.getElementById("submitter-photos");
const uploadButton = uploadForm?.querySelector('button[type="submit"]');
const uploadProgress = document.getElementById("upload-progress");

const MAX_IMAGE_SIDE = 2400;
const JPEG_QUALITY = 0.86;

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Foto kon niet worden verkleind."));
    };
    image.src = url;
  });
}

async function resizePhoto(file) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale === 1 && file.size < 2.5 * 1024 * 1024) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
  if (!blob || blob.size >= file.size) return file;

  const cleanName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${cleanName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

uploadForm?.addEventListener("submit", async (event) => {
  const files = Array.from(uploadInput?.files || []);
  if (!files.length) return;

  event.preventDefault();
  uploadButton.disabled = true;
  if (uploadProgress) uploadProgress.hidden = false;
  uploadButton.textContent = "Foto's verkleinen...";

  try {
    const resizedFiles = await Promise.all(files.map(resizePhoto));
    const transfer = new DataTransfer();
    resizedFiles.forEach((file) => transfer.items.add(file));
    uploadInput.files = transfer.files;

    uploadButton.textContent = "Uploaden...";
    uploadForm.submit();
  } catch (error) {
    uploadButton.disabled = false;
    if (uploadProgress) uploadProgress.hidden = true;
    uploadButton.textContent = "Insturen";
    alert(error.message || "Foto's verkleinen is niet gelukt.");
  }
});
