/**
 * ZenPomodoro - メインロジックファイル
 * すべてのコメントは日本語で記述されています。
 */

// -------------------------------------------------------------
// アプリケーションの状態管理
// -------------------------------------------------------------
let settings = {
  workDuration: 25,       // 作業時間 (分)
  shortBreakDuration: 5,  // 短い休憩 (分)
  longBreakDuration: 15,  // 長い休憩 (分)
  volume: 0.5,            // アラーム音量 (0.0 〜 1.0)
  theme: 'neon'           // 'neon' または 'nordic'
};

let timerState = {
  timeLeft: 25 * 60,      // 残り秒数
  duration: 25 * 60,      // 現在のモードの総秒数
  isRunning: false,
  currentMode: 'work',    // 'work' | 'shortBreak' | 'longBreak'
  expectedEndTime: null,  // 終了予定のタイムスタンプ
  worker: null            // バックグラウンド動作用 Web Worker
};

// 点滅通知用の管理変数
let titleFlashInterval = null;

// -------------------------------------------------------------
// DOM要素の取得
// -------------------------------------------------------------
const timerTimeDisplay = document.getElementById('timer-time');
const timerStatusDisplay = document.getElementById('timer-status');
const startPauseBtn = document.getElementById('start-pause-btn');
const startPauseText = document.getElementById('start-pause-text');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const resetBtn = document.getElementById('reset-btn');
const modeTabs = document.querySelectorAll('.mode-tab');
const progressCircle = document.querySelector('.timer-progress');

// 設定モーダル要素
const settingsModal = document.getElementById('settings-modal');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const requestNotificationBtn = document.getElementById('request-notification-btn');

const inputWork = document.getElementById('input-work');
const inputShort = document.getElementById('input-short');
const inputLong = document.getElementById('input-long');
const inputVolume = document.getElementById('input-volume');
const volumeDisplay = document.getElementById('volume-val-display');
const themeBtns = document.querySelectorAll('.theme-opt-btn');

// PWA インストールボタン
const pwaInstallBtn = document.getElementById('pwa-install-btn');
let deferredPrompt = null;

// -------------------------------------------------------------
// 初期化処理
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  loadLocalStorage();
  applySettings();
  initWebWorker();
  initEventListeners();
  updateDisplay();
  
  // Service Worker の登録 (PWAの有効化)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('Service Worker 登録成功！スコープ:', reg.scope))
      .catch(err => console.error('Service Worker 登録失敗...', err));
  }
  
  // 初回起動時に通知許可をスマートに要求
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => {
      requestNotificationPermission(false); // サイレント要求
    }, 1500);
  }
});

// -------------------------------------------------------------
// ローカルストレージ連携
// -------------------------------------------------------------
function loadLocalStorage() {
  // 設定のロード
  const savedSettings = localStorage.getItem('zen_pomo_settings');
  if (savedSettings) {
    try {
      settings = { ...settings, ...JSON.parse(savedSettings) };
    } catch (e) {
      console.error('設定のパースに失敗しました。', e);
    }
  }
}

function saveSettingsToStorage() {
  localStorage.setItem('zen_pomo_settings', JSON.stringify(settings));
}

// -------------------------------------------------------------
// 設定の反映
// -------------------------------------------------------------
function applySettings() {
  // テーマの反映
  document.body.className = settings.theme === 'nordic' ? 'theme-nordic' : 'theme-neon';
  
  // アクティブなテーマボタンの選択表示
  themeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === settings.theme);
  });

  // 設定フォームの初期値をセット
  inputWork.value = settings.workDuration;
  inputShort.value = settings.shortBreakDuration;
  inputLong.value = settings.longBreakDuration;
  inputVolume.value = settings.volume;
  volumeDisplay.textContent = `${Math.round(settings.volume * 100)}%`;

  // タイマーの初期時間をセット (実行中でなければ現在のモードに合わせてリセット)
  if (!timerState.isRunning) {
    resetTimer(false); // UIだけ更新
  }
}

// -------------------------------------------------------------
// インライン Web Worker の初期化 (高精度バックグラウンド処理用)
// -------------------------------------------------------------
function initWebWorker() {
  // バックグラウンドでタイマーを正確に刻むための Worker コード
  const workerCode = `
    let timerId = null;
    self.onmessage = function(e) {
      if (e.data === 'start') {
        if (timerId) clearInterval(timerId);
        timerId = setInterval(() => {
          self.postMessage('tick');
        }, 200); // 200ms毎にメインスレッドへシグナルを送信
      } else if (e.data === 'stop') {
        if (timerId) {
          clearInterval(timerId);
          timerId = null;
        }
      }
    };
  `;

  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);
  timerState.worker = new Worker(workerUrl);

  timerState.worker.onmessage = (e) => {
    if (e.data === 'tick' && timerState.isRunning) {
      processTimerTick();
    }
  };
}

// -------------------------------------------------------------
// タイマーロジック
// -------------------------------------------------------------
function startTimer() {
  if (timerState.isRunning) return;

  stopTitleFlashing(); // 点滅があれば停止

  timerState.isRunning = true;
  // 終了予定時刻を確定（ミリ秒）
  timerState.expectedEndTime = Date.now() + timerState.timeLeft * 1000;
  
  // UIの更新
  startPauseText.textContent = '一時停止';
  playIcon.style.display = 'none';
  pauseIcon.style.display = 'block';
  
  // Web Worker を開始
  timerState.worker.postMessage('start');
  
  // モードをBodyに適用してグラデーションを変化させる
  applyModeStyles();
}

function pauseTimer() {
  if (!timerState.isRunning) return;

  timerState.isRunning = false;
  // Web Worker を停止
  timerState.worker.postMessage('stop');

  // UIの更新
  startPauseText.textContent = 'スタート';
  playIcon.style.display = 'block';
  pauseIcon.style.display = 'none';
}

function resetTimer(forceStop = true) {
  if (forceStop) {
    pauseTimer();
  }

  stopTitleFlashing(); // 点滅があれば停止

  // 時間の再決定
  let mins = settings.workDuration;
  if (timerState.currentMode === 'shortBreak') mins = settings.shortBreakDuration;
  else if (timerState.currentMode === 'longBreak') mins = settings.longBreakDuration;

  timerState.timeLeft = mins * 60;
  timerState.duration = mins * 60;
  
  updateDisplay();
}

function processTimerTick() {
  const now = Date.now();
  const diff = timerState.expectedEndTime - now;

  if (diff <= 0) {
    timerState.timeLeft = 0;
    updateDisplay();
    handleTimerCompletion();
  } else {
    // 正確な残秒数を計算
    timerState.timeLeft = Math.ceil(diff / 1000);
    updateDisplay();
  }
}

// タイマー表示と円形プログレスの更新
function updateDisplay() {
  if (titleFlashInterval) return; // 点滅中は表示更新をスキップ

  const minutes = Math.floor(timerState.timeLeft / 60);
  const seconds = timerState.timeLeft % 60;
  
  // MM:SS 形式にパディング
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  timerTimeDisplay.textContent = timeStr;
  
  // ブラウザのタブタイトルにも時間を表示 (PWAのUX向上)
  let statusEmoji = '🍅';
  if (timerState.currentMode === 'shortBreak') statusEmoji = '🌱';
  else if (timerState.currentMode === 'longBreak') statusEmoji = '💤';
  document.title = `${timeStr} ${statusEmoji} ZenPomodoro`;

  // 円形プログレスバーの更新
  const percent = timerState.timeLeft / timerState.duration;
  const dashoffset = 597 * (1 - percent);
  progressCircle.style.strokeDashoffset = dashoffset;

  // ステータステキストの更新
  if (timerState.isRunning) {
    if (timerState.currentMode === 'work') {
      timerStatusDisplay.textContent = '極上の集中をニキへ';
    } else {
      timerStatusDisplay.textContent = '深く息を吸ってリフレッシュ';
    }
  } else {
    if (timerState.currentMode === 'work') {
      timerStatusDisplay.textContent = '集中を始めよう';
    } else {
      timerStatusDisplay.textContent = '休憩の時間だよ';
    }
  }
}

// タイマー終了時の処理
function handleTimerCompletion() {
  pauseTimer();
  playAlarm();
  sendPushNotification();
  startTitleFlashing(); // タブとタスクバーの点滅通知を開始

  // モードスイッチ
  if (timerState.currentMode === 'work') {
    switchMode('shortBreak');
  } else {
    switchMode('work');
  }
}

function switchMode(mode) {
  timerState.currentMode = mode;
  
  // タブの選択表示を更新
  modeTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  applyModeStyles();
  resetTimer(true);
}

function applyModeStyles() {
  document.body.classList.toggle('mode-break', timerState.currentMode === 'shortBreak');
  document.body.classList.toggle('mode-long-break', timerState.currentMode === 'longBreak');
}

// -------------------------------------------------------------
// タスクバー・タブタイトル点滅通知機能
// -------------------------------------------------------------
function startTitleFlashing() {
  if (titleFlashInterval) return;

  let isFlash = false;
  const statusText = timerState.currentMode === 'work' ? '休憩終了！' : '作業完了！🍅';
  
  // タブタイトルの高速点滅アニメーション (OSのタスクバーとタブが点滅状態になります)
  titleFlashInterval = setInterval(() => {
    document.title = isFlash ? `【!!!】${statusText}` : `✨ ${statusText} ✨`;
    isFlash = !isFlash;
  }, 500);

  // PWA App Badge API を使用したタスクバーアプリアイコンへの通知バッジ設定
  if ('setAppBadge' in navigator) {
    navigator.setAppBadge().catch(err => console.error('バッジ設定失敗:', err));
  }
}

function stopTitleFlashing() {
  if (titleFlashInterval) {
    clearInterval(titleFlashInterval);
    titleFlashInterval = null;
    
    // PWA アプリバッジをクリア
    if ('clearAppBadge' in navigator) {
      navigator.clearAppBadge().catch(err => console.error('バッジクリア失敗:', err));
    }
    
    // タイマー画面の表示を通常状態にリセット
    updateDisplay();
  }
}

// -------------------------------------------------------------
// Web Audio API による澄んだシンセチャイムの合成
// -------------------------------------------------------------
function playAlarm() {
  if (settings.volume === 0) return;

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // 2つの周波数で美しい和音（ベル音）を作成
    // F#5 (880Hz) + C#6 (1109Hz) で、心地よい澄んだ目覚まし音を演出
    const frequencies = [880, 1109.73];
    
    frequencies.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = idx === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      
      // 音量調整とフェードアウト
      gain.gain.setValueAtTime(0, audioCtx.currentTime);
      // 急激に立ち上げてから徐々に小さくする
      gain.gain.linearRampToValueAtTime(settings.volume * 0.4, audioCtx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.8);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start();
      osc.stop(audioCtx.currentTime + 2.0);
    });
  } catch (e) {
    console.error('オーディオの再生に失敗しました。', e);
  }
}

// -------------------------------------------------------------
// デスクトップ通知 (Notification API)
// -------------------------------------------------------------
function requestNotificationPermission(showResultAlert = true) {
  if (!('Notification' in window)) {
    if (showResultAlert) alert('このブラウザは通知に対応していません。');
    return;
  }

  Notification.requestPermission().then(permission => {
    if (permission === 'granted') {
      if (showResultAlert) {
        new Notification('ZenPomodoro', {
          body: '通知が有効化されたぜ、ニキ！タイマー終了時にここでお知らせするよ！',
          icon: 'icons/icon-192.png'
        });
      }
      requestNotificationBtn.textContent = '許可済み';
      requestNotificationBtn.disabled = true;
    } else {
      if (showResultAlert) alert('通知が拒否されました。ブラウザの設定から変更してください。');
    }
  });
}

function sendPushNotification() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // アプリがバックグラウンド、またはタブが非アクティブの時に通知を表示
  if (document.hidden) {
    let title = '作業完了！';
    let body = 'ポモドーロが完了したよ！少し休憩しよう、ニキ！🍅';
    
    if (timerState.currentMode === 'shortBreak' || timerState.currentMode === 'longBreak') {
      title = '休憩終了！';
      body = 'リフレッシュできたかな？次の集中を始めようぜ！🎯';
    }

    new Notification(title, {
      body: body,
      icon: 'icons/icon-192.png',
      tag: 'zen-pomodoro-alert',
      requireInteraction: true // ユーザーが閉じるまで表示し続ける
    });
  }
}

// -------------------------------------------------------------
// イベントリスナーのセットアップ
// -------------------------------------------------------------
function initEventListeners() {
  // タイマーコントロール
  startPauseBtn.addEventListener('click', () => {
    if (timerState.isRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  });

  resetBtn.addEventListener('click', () => {
    resetTimer(true);
  });

  // モードタブの切り替え
  modeTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const mode = e.target.dataset.mode;
      if (timerState.currentMode !== mode) {
        switchMode(mode);
      }
    });
  });

  // 設定モーダルの開閉
  settingsToggleBtn.addEventListener('click', () => {
    // フォームに現在の設定値を読み込む
    applySettings();
    settingsModal.style.display = 'flex';
    
    // 通知ボタンの状態更新
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        requestNotificationBtn.textContent = '許可済み';
        requestNotificationBtn.disabled = true;
      } else {
        requestNotificationBtn.textContent = '許可を有効化';
        requestNotificationBtn.disabled = false;
      }
    } else {
      requestNotificationBtn.textContent = '非対応';
      requestNotificationBtn.disabled = true;
    }
  });

  const closeModal = () => {
    settingsModal.style.display = 'none';
  };

  settingsCloseBtn.addEventListener('click', closeModal);
  
  // モーダルの背景クリックで閉じる
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeModal();
    }
  });

  // 音量スライダーの数値同期表示
  inputVolume.addEventListener('input', (e) => {
    volumeDisplay.textContent = `${Math.round(e.target.value * 100)}%`;
  });

  // テーマのリアルタイムプレビュー切り替え
  themeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const selectedTheme = e.currentTarget.dataset.theme;
      
      themeBtns.forEach(b => b.classList.toggle('active', b === e.currentTarget));
      document.body.className = selectedTheme === 'nordic' ? 'theme-nordic' : 'theme-neon';
      applyModeStyles(); // モードのクラスも維持する
    });
  });

  // 設定の保存
  saveSettingsBtn.addEventListener('click', () => {
    const workVal = parseInt(inputWork.value);
    const shortVal = parseInt(inputShort.value);
    const longVal = parseInt(inputLong.value);
    const volumeVal = parseFloat(inputVolume.value);
    
    // アクティブなテーマボタンからテーマ名を取得
    const activeThemeBtn = document.querySelector('.theme-opt-btn.active');
    const themeVal = activeThemeBtn ? activeThemeBtn.dataset.theme : 'neon';

    // バリデーション
    if (isNaN(workVal) || workVal < 1 || workVal > 60 ||
        isNaN(shortVal) || shortVal < 1 || shortVal > 30 ||
        isNaN(longVal) || longVal < 1 || longVal > 60) {
      alert('時間は正しい数値（1〜60分）で入力してね！');
      return;
    }

    settings.workDuration = workVal;
    settings.shortBreakDuration = shortVal;
    settings.longBreakDuration = longVal;
    settings.volume = volumeVal;
    settings.theme = themeVal;

    saveSettingsToStorage();
    applySettings();
    closeModal();
  });

  // 通知の許可要求テストボタン
  requestNotificationBtn.addEventListener('click', () => {
    requestNotificationPermission(true);
  });

  // PWA インストールハンドリング
  window.addEventListener('beforeinstallprompt', (e) => {
    // デフォルトのインストールプロンプトを抑制
    e.preventDefault();
    deferredPrompt = e;
    // カスタムインストールボタンを表示
    pwaInstallBtn.style.display = 'flex';
  });

  pwaInstallBtn.addEventListener('click', () => {
    if (!deferredPrompt) return;
    
    // プロンプトを表示
    deferredPrompt.prompt();
    
    // ユーザーの回答を待つ
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('ユーザーがアプリのインストールを承諾しました。');
      } else {
        console.log('ユーザーがアプリのインストールを拒否しました。');
      }
      deferredPrompt = null;
      pwaInstallBtn.style.display = 'none';
    });
  });

  window.addEventListener('appinstalled', () => {
    console.log('ZenPomodoro がインストールされました！');
    pwaInstallBtn.style.display = 'none';
    deferredPrompt = null;
  });

  // ユーザーがタブに戻った時やフォーカスした時にタイトル点滅通知を消す
  window.addEventListener('focus', stopTitleFlashing);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      stopTitleFlashing();
    }
  });
}
