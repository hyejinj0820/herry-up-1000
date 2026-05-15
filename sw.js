self.addEventListener('install', (e) => self.skipWaiting());

// 서버에서 실제 푸시가 왔을 때 — 헤드업 알림으로 표시됨
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(data.title || '허리 펴! 🧘‍♀️', {
      body: data.body || '허리 수술비 천만원 !! 💸',
      icon: '/herry-up-1000/icon.png',
      badge: '/herry-up-1000/badge.png',
      vibrate: [300, 100, 300, 100, 300],
      tag: 'posture-alarm',
      renotify: true,
      requireInteraction: true,
      silent: false,
      actions: [
        { action: 'ok', title: '✅ 폈어요!' },
        { action: 'later', title: '🙈 나중에' }
      ]
    })
  );
});

self.addEventListener('activate', (e) => {
  // SW가 업데이트되거나 재시작될 때 캐시에서 알람 복구
  e.waitUntil(self.clients.claim().then(resumeFromCache));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  const openApp = () => self.clients.openWindow('/herry-up-1000/');

  let isAndroid = false;
  try { isAndroid = /android/i.test(navigator.userAgent); } catch (_) {}
  const isPeosyeo = isAndroid ? e.action === 'later' : e.action === 'ok';
  const isNachunge = isAndroid ? e.action === 'ok'   : e.action === 'later';

  if (isPeosyeo) {
    e.waitUntil(
      self.registration.showNotification('허리수술비 아꼈다 💸', {
        body: '다음 알림까지 잘 유지해봐요!',
        icon: '/herry-up-1000/icon.png',
        badge: '/herry-up-1000/badge.png',
        tag: 'feedback-ok',
        silent: true,
      })
    );
  } else if (isNachunge) {
    e.waitUntil(
      Promise.all([
        self.registration.showNotification('⏰ 5분 뒤 다시 알려드릴게요!', {
          body: '잠깐 쉬고 다시 해봐요!',
          icon: '/herry-up-1000/icon.png',
          badge: '/herry-up-1000/badge.png',
          tag: 'feedback-later',
          silent: true,
        }),
        scheduleSnooze(5 * 60 * 1000)
      ])
    );
  } else {
    e.waitUntil(openApp());
  }
});

self.addEventListener('message', (e) => {
  if (!e.data) return;

  if (e.data.type === 'START_ALARM') {
    const { mins, name, msg } = e.data;
    e.waitUntil(
      stopCurrentAlarm().then(async () => {
        self.alarmActive = true;
        await saveConfig(mins, name, msg, Date.now() + mins * 60 * 1000);
        await sendAlarm(name, msg);
        return scheduleAlarm(mins, name, msg, mins * 60 * 1000);
      })
    );
  }

  // 페이지 재시작 시 캐시 기반으로 알람 이어받기 (즉시 알림 없이)
  if (e.data.type === 'RESUME_ALARM') {
    if (!self.alarmActive) {
      e.waitUntil(resumeFromCache());
    }
  }

  if (e.data.type === 'STOP_ALARM') {
    e.waitUntil(stopCurrentAlarm());
  }

  // 페이지에서 25초마다 보내는 ping — SW가 kill된 뒤 재시작됐으면 알람 복구
  if (e.data.type === 'PING') {
    e.waitUntil(
      (async () => {
        if (!self.alarmActive) {
          const config = await loadConfig();
          if (config) await resumeFromCache();
        }
      })()
    );
  }
});

async function resumeFromCache() {
  const config = await loadConfig();
  if (!config || self.alarmActive) return;
  self.alarmActive = true;

  const remaining = Math.max(0, config.nextAt - Date.now());
  if (remaining === 0) {
    // 앱이 닫혀있는 동안 알림이 지나갔으면 즉시 한 번 발송
    await sendAlarm(config.name, config.msg);
    await saveConfig(config.mins, config.name, config.msg, Date.now() + config.mins * 60 * 1000);
    return scheduleAlarm(config.mins, config.name, config.msg, config.mins * 60 * 1000);
  }
  // 아직 안 지났으면 남은 시간만큼 기다렸다가 발송
  return scheduleAlarm(config.mins, config.name, config.msg, remaining);
}

async function stopCurrentAlarm() {
  self.alarmActive = false;
  if (self.releaseLock) { self.releaseLock(); self.releaseLock = null; }
  if (self.alarmTimer) { clearTimeout(self.alarmTimer); self.alarmTimer = null; }
  if (self.releaseSnooze) { self.releaseSnooze(); self.releaseSnooze = null; }
  if (self.snoozeTimer) { clearTimeout(self.snoozeTimer); self.snoozeTimer = null; }
  await clearConfig();
}

function scheduleAlarm(mins, name, msg, delay) {
  if (!self.alarmActive) return Promise.resolve();

  // Web Locks: lock을 보유하는 동안 Android OS가 SW를 kill하지 않음
  if ('locks' in navigator) {
    return navigator.locks.request('alarm-hold', { mode: 'shared' }, () =>
      new Promise((resolve) => {
        self.releaseLock = resolve;
        self.alarmTimer = setTimeout(async () => {
          if (!self.alarmActive) { resolve(); return; }
          self.releaseLock = null;
          await sendAlarm(name, msg);
          await saveConfig(mins, name, msg, Date.now() + mins * 60 * 1000);
          resolve();
          scheduleAlarm(mins, name, msg, mins * 60 * 1000);
        }, delay);
      })
    );
  }

  // Web Locks 미지원 시 fallback
  return new Promise((resolve) => {
    self.alarmTimer = setTimeout(async () => {
      if (!self.alarmActive) { resolve(); return; }
      await sendAlarm(name, msg);
      await saveConfig(mins, name, msg, Date.now() + mins * 60 * 1000);
      resolve();
      scheduleAlarm(mins, name, msg, mins * 60 * 1000);
    }, delay);
  });
}

function sendAlarm(name, msg) {
  return self.registration.showNotification(`${name}, ${msg} 🧘‍♀️`, {
    body: '허리 수술비 천만원 !! 💸',
    icon: '/herry-up-1000/icon.png',
    badge: '/herry-up-1000/badge.png',
    vibrate: [300, 100, 300, 100, 300],
    tag: 'posture-alarm',
    renotify: true,
    requireInteraction: true,
    silent: false,
    actions: [
      { action: 'ok', title: '✅ 폈어요!' },
      { action: 'later', title: '🙈 나중에' }
    ]
  });
}

async function scheduleSnooze(delay) {
  const config = await loadConfig();
  if (!config) return;
  const { name, msg } = config;

  const fire = () => sendAlarm(name, msg);

  if ('locks' in navigator) {
    return navigator.locks.request('snooze-hold', { mode: 'shared' }, () =>
      new Promise(resolve => {
        self.releaseSnooze = resolve;
        self.snoozeTimer = setTimeout(async () => {
          self.releaseSnooze = null;
          self.snoozeTimer = null;
          await fire();
          resolve();
        }, delay);
      })
    );
  }
  return new Promise(resolve => {
    self.snoozeTimer = setTimeout(async () => {
      self.snoozeTimer = null;
      await fire();
      resolve();
    }, delay);
  });
}

// Cache Storage에 알람 설정 + 다음 알림 시각 저장
async function saveConfig(mins, name, msg, nextAt) {
  try {
    const cache = await caches.open('alarm-v1');
    await cache.put('/alarm-config', new Response(JSON.stringify({ mins, name, msg, nextAt })));
  } catch(e) {}
}

async function loadConfig() {
  try {
    const cache = await caches.open('alarm-v1');
    const res = await cache.match('/alarm-config');
    return res ? await res.json() : null;
  } catch(e) { return null; }
}

async function clearConfig() {
  try {
    const cache = await caches.open('alarm-v1');
    await cache.delete('/alarm-config');
  } catch(e) {}
}
