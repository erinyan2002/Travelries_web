// Shared by every Storage upload path (personal photos, collab albums, shares).
export function base64ToBlob(dataUrl: string): { blob: Blob; mimeType: string } {
  const [header, data] = dataUrl.split(",");
  const mimeType = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const binary = atob(data);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return { blob: new Blob([arr], { type: mimeType }), mimeType };
}
