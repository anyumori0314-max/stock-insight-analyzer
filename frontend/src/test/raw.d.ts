// Lets tests import raw file contents via Vite's `?raw` loader (used to assert
// static metadata in index.html / public without pulling in Node's fs types).
declare module "*?raw" {
  const content: string;
  export default content;
}
