const utf8Encoder = new TextEncoder();

export function encodeUtf8ToBase64(value: string): string {
  const bytes = utf8Encoder.encode(value);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}
