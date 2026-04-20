export const createJpegBlobFromSource = (
  source,
  sourceWidth,
  sourceHeight,
  {
    canvas = null,
    maxWidth,
    quality,
  } = {}
) => {
  return new Promise((resolve, reject) => {
    if (!source) {
      reject(new Error("Image source is required"));
      return;
    }

    const resolvedCanvas = canvas || document.createElement("canvas");
    const scale = sourceWidth > maxWidth
      ? maxWidth / sourceWidth
      : 1;

    resolvedCanvas.width = Math.max(1, Math.round(sourceWidth * scale));
    resolvedCanvas.height = Math.max(1, Math.round(sourceHeight * scale));

    const ctx = resolvedCanvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Canvas 2D context is unavailable"));
      return;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, resolvedCanvas.width, resolvedCanvas.height);
    resolvedCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("JPEG encoding failed"));
        return;
      }

      resolve(blob);
    }, "image/jpeg", quality);
  });
};

export const blobToDataUrl = (blob) => {
  return new Promise((resolve, reject) => {
    if (!(blob instanceof Blob)) {
      reject(new Error("Blob is required"));
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Blob could not be converted to data URL"));
    };
    reader.onerror = () => {
      reject(reader.error || new Error("Blob could not be read"));
    };
    reader.readAsDataURL(blob);
  });
};
