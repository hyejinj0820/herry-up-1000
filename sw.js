self.addEventListener('install', (e) => self.skipWaiting());

// 서버에서 실제 푸시가 왔을 때 — 헤드업 알림으로 표시됨
self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || '허리 펴! 🧘‍♀️', {
      body: data.body || '허리 수술비 천만원 !! 💸',
      icon: '/herry-up-1000/icon.png',
      badge: '/herry-up-1000/badge.png',
      vibrate: [300, 100, 300, 100, 300],
      tag: 'posture-alarm-' + Date.now(),
      silent: false,
    })
  );
});

self.addEventListener('activate', (e) => {
  // SW가 업데이트되거나 재시작될 때 캐시에서 알람 복구
  e.waitUntil(self.clients.claim().then(resumeFromCache));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/herry-up-1000/'));
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

  // 페이지에서 25초마다 보내는 ping — SW가 kill되지 않도록 유지
  if (e.data.type === 'PING') {
    e.waitUntil(Promise.resolve());
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
    tag: 'posture-alarm-' + Date.now(),
    silent: false,
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
