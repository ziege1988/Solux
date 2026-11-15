'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('solux', {
  getConfig: inv('config:get'),
  setConfig: inv('config:set'),
  refresh: inv('data:refresh'),
  sunImage: inv('data:sun'),
  regions: inv('data:regions'),
  regionHistory: inv('data:regionHistory'),
  flares: inv('data:flares'),
  flaresAround: inv('data:flaresAround'),
  news: inv('data:news'),
  weather: inv('data:weather'),
  rateSeeing: inv('data:rateSeeing'),
  seeing: { record: inv('seeing:record'), info: inv('seeing:info'), reset: inv('seeing:reset') },
  diary: { add: inv('diary:add'), list: inv('diary:list'), image: inv('diary:image'), remove: inv('diary:remove'), note: inv('diary:note'), info: inv('diary:info') },
  storeInfo: inv('data:storeInfo'),
  clearImages: inv('data:clearImages'),
  geoSearch: inv('geo:search'),
  quit: inv('app:quit'),
  openRecordings: inv('app:openRecordings'),
  openViewer: inv('app:openViewer'),
  hideWidget: inv('app:hideWidget'),
  openExternal: inv('app:openExternal'),
  showLog: inv('app:showLog'),
  rec: {
    openDialog: inv('rec:openDialog'),
    load: inv('rec:load'),
    chooseFolder: inv('rec:chooseFolder'),
    save: inv('rec:save'),
    reveal: inv('rec:reveal'),
    profileUpdate: inv('rec:profileUpdate'),
    profileReset: inv('rec:profileReset'),
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  update: { check: inv('update:check'), install: inv('update:install') },
  on: (channel, fn) => {
    const allowed = ['data-updated', 'show-settings', 'update-available', 'update-progress', 'recordings-opened', 'recordings-closed'];
    if (!allowed.includes(channel)) return () => {};
    const h = (_e, p) => fn(p);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
});
