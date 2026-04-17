self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  return self.clients.claim();
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(clients.openWindow('/herry-up-1000/'));
});

// 메인 앱에서 메시지 받아서 알림 예약
self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'START_ALARM') {
    const { mins, name, msg } = e.data;
    
    // 기존 타이머 있으면 취소
    if (self.alarmTimer) {
      clearInterval(self.alarmTimer);
    }

    // 즉시 첫 알림
    sendAlarm(name, msg);

    // 반복 알림
    self.alarmTimer = setInterval(function() {
      sendAlarm(name, msg);
    }, mins * 60 * 1000);
  }

  if (e.data && e.data.type === 'STOP_ALARM') {
    if (self.alarmTimer) {
      clearInterval(self.alarmTimer);
      self.alarmTimer = null;
    }
  }
});

function sendAlarm(name, msg) {
  self.registration.showNotification(name + ', ' + msg + ' 🧘‍♀️', {
    body: '허리 수술비 천만원 !! 💸',
    icon: '/herry-up-1000/icon.svg',
    badge: '/herry-up-1000/icon.svg',
    vibrate: [200, 100, 200],
    requireInteraction: false
  });
}
