/* Rechnet die Ausrichtung im Hintergrund, damit die Animationen flüssig bleiben. */
importScripts('../shared/align.js');
self.onmessage = (e) => {
  const { id, task, args } = e.data;
  try {
    let result;
    if (task === 'align') result = self.SoluxAlign.align(args.user, args.ref, args.mode, args.opts);
    else if (task === 'disc') result = self.SoluxAlign.detectDisc(args.gray, args.w, args.h);
    else if (task === 'classify') result = self.SoluxAlign.classifyImage(args.gray, args.w, args.h, args.opts);
    else if (task === 'surface') result = self.SoluxAlign.alignSurface(args.user, args.refSpots, args.mode, args.opts);
    else if (task === 'blobs') result = self.SoluxAlign.detectBlobs(args.gray, args.w, args.h, args.opts);
    else if (task === 'texture') result = self.SoluxAlign.textureIndex(args.gray, args.w, args.h, args.disc);
    else if (task === 'sharp') result = self.SoluxAlign.limbSharpness(args.gray, args.w, args.h, args.disc);
    else if (task === 'proms') result = self.SoluxAlign.measureProminences(args.gray, args.w, args.h, args.disc, args.opts);
    else if (task === 'spots') result = self.SoluxAlign.detectSpots(args.gray, args.w, args.h, args.disc, args.rotation, args.flip, args.opts);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
