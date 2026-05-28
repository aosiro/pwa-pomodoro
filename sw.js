/**
 * ZenPomodoro - Service Worker
 * オフライン動作をサポートするためのキャッシュ制御を行います。
 * コメントはすべて日本語で記述されています。
 */

const CACHE_NAME = 'zen-pomodoro-cache-v3';

// キャッシュ対象の静的アセット
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'index.css',
  'app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

// 1. インストールイベント: アセットのキャッシュ
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] 静的アセットをキャッシュ中...');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      // 待機状態に入らずに、すぐに新しいサービスワーカーをアクティブにする
      return self.skipWaiting();
    })
  );
});

// 2. アクティベートイベント: 古いキャッシュの削除
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] 古いキャッシュを削除中:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // 現在のアクティブなサービスワーカーがクライアントを直ちに制御できるようにする
      return self.clients.claim();
    })
  );
});

// 3. フェッチイベント: リソース取得時のキャッシュ戦略 (Stale-While-Revalidate)
// まずキャッシュから返し、バックグラウンドでネットワークから最新データをフェッチしてキャッシュを更新
self.addEventListener('fetch', (e) => {
  // ブラウザ拡張機能などのURL (chrome-extension:// 等) はスキップ
  if (!e.request.url.startsWith(self.location.origin) && !e.request.url.startsWith('https://fonts.googleapis.com') && !e.request.url.startsWith('https://fonts.gstatic.com')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        // キャッシュがあればそれを返しつつ、バックグラウンドでネットワークからも取得して更新
        fetch(e.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, networkResponse);
            });
          }
        }).catch(() => {
          // オフライン時はフェッチ失敗するがキャッシュがあるため問題なし
        });
        return cachedResponse;
      }

      // キャッシュになければネットワークから取得
      return fetch(e.request).then((networkResponse) => {
        // レスポンスが正常な場合のみキャッシュに格納
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});

// 4. 通知クリックイベント: 通知をクリックした時にアプリを開く
self.addEventListener('notificationclick', (e) => {
  // 通知を閉じる
  e.notification.close();

  // すでに開いているウィンドウを探してフォーカスするか、新しいウィンドウで開く
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // すでにアプリのタブが開いていたらそちらにフォーカス
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // 開いていなければ新しいタブでアプリを開く
      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});

