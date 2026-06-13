import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_STAGES = [
  { name: 'Session', duration: 35 * 60, color: '#00C853' },
  { name: 'Wrapping Up', duration: 7 * 60, color: '#FFD600' },
  { name: 'Consolidating', duration: 5 * 60, color: '#FF6D00' },
  { name: 'Closing', duration: 3 * 60, color: '#D50000' },
];

const CIRCUMFERENCE = 2 * Math.PI * 34;

function loadStages() {
  try {
    const saved = JSON.parse(localStorage.getItem('sessionStages') || 'null');
    if (Array.isArray(saved) && saved.length === DEFAULT_STAGES.length) {
      return saved.map((savedStage, index) => ({
        ...DEFAULT_STAGES[index],
        ...savedStage,
        color: savedStage.color || DEFAULT_STAGES[index].color,
      }));
    }
  } catch (error) {
    console.warn('Failed to load stage config', error);
  }
  return DEFAULT_STAGES.map((stage) => ({ ...stage }));
}

function hexToRgb(hex) {
  const cleaned = hex.replace('#', '');
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

function colorIsLight(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 180;
}

function rgbToInt({ r, g, b }) {
  return (r << 16) | (g << 8) | b;
}

function rgbToHex({ r, g, b }) {
  const toHex = (value) => value.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function useLocalStorage(key, defaultValue) {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

function StageSettings({ stages, onChange }) {
  return (
    <div className="stage-settings">
      <div className="stage-grid-head">
        <div>Session</div>
        <div>Duration (minutes)</div>
        <div>Colour</div>
      </div>
      {stages.map((stage, index) => (
        <div className="stage-row" key={stage.name}>
          <div className="stage-label">
            <div className="stage-title">{stage.name}</div>
            <div className="stage-meta">{Math.round(stage.duration / 60)} min</div>
          </div>
          <input
            id={`stageDuration${index}`}
            type="number"
            min="1"
            step="1"
            value={Math.round(stage.duration / 60)}
            onChange={(event) => onChange(index, { duration: Number(event.target.value) * 60 })}
          />
          <div className="color-input-wrapper">
            <input
              id={`stageColor${index}`}
              type="color"
              value={stage.color}
              onChange={(event) => onChange(index, { color: event.target.value })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [stages, setStages] = useState(loadStages);
  const [elapsed, setElapsed] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(-1);
  const [sessionCount, setSessionCount] = useState(0);
  const [paused, setPaused] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('device');
  const [saveStatus, setSaveStatus] = useState('');
  const [testStatus, setTestStatus] = useState('');
  const [testColor, setTestColor] = useState('#00C853');
  const [testRgb, setTestRgb] = useState(() => hexToRgb('#00C853'));
  const [devices, setDevices] = useState([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [apiKey, setApiKey] = useState(localStorage.getItem('g_apiKey') || '');
  const [deviceId, setDeviceId] = useState(localStorage.getItem('g_dev') || '');
  const [deviceModel, setDeviceModel] = useState(localStorage.getItem('g_mod') || '');
  const [readyLamp, setReadyLamp] = useState(Boolean(apiKey && deviceId && deviceModel));
  const intervalRef = useRef(null);
  const wakeLockRef = useRef(null);

  const totalDuration = useMemo(
    () => stages.reduce((sum, stage) => sum + stage.duration, 0),
    [stages]
  );

  const activeStage = useMemo(() => {
    if (currentStageIndex < 0 || currentStageIndex >= stages.length) return null;
    return stages[currentStageIndex];
  }, [currentStageIndex, stages]);

  const stageIndexAt = useCallback(
    (seconds) => {
      let accrued = 0;
      for (let i = 0; i < stages.length; i += 1) {
        accrued += stages[i].duration;
        if (seconds < accrued) return i;
      }
      return stages.length;
    },
    [stages]
  );

  const stageStart = useCallback(
    (idx) => stages.slice(0, idx).reduce((sum, stage) => sum + stage.duration, 0),
    [stages]
  );

  const currentStageLeft = useMemo(() => {
    if (currentStageIndex < 0 || !activeStage) return 0;
    const inStage = elapsed - stageStart(currentStageIndex);
    return Math.max(activeStage.duration - inStage, 0);
  }, [activeStage, currentStageIndex, elapsed, stageStart]);

  const progressOffset = useMemo(() => {
    if (!activeStage) return CIRCUMFERENCE;
    const inStage = elapsed - stageStart(currentStageIndex);
    return CIRCUMFERENCE * (1 - inStage / activeStage.duration);
  }, [activeStage, currentStageIndex, elapsed, stageStart]);

  const activeColor = activeStage?.color || '#111318';
  const activeDark = activeStage ? colorIsLight(activeStage.color) : false;

  useEffect(() => {
    localStorage.setItem('g_apiKey', apiKey);
    localStorage.setItem('g_dev', deviceId);
    localStorage.setItem('g_mod', deviceModel);
    setReadyLamp(Boolean(apiKey && deviceId && deviceModel));
  }, [apiKey, deviceId, deviceModel]);

  useEffect(() => {
    localStorage.setItem('sessionStages', JSON.stringify(stages));
  }, [stages]);

  useEffect(() => {
    const isInStage = currentStageIndex >= 0 && currentStageIndex < stages.length;
    if (paused || !isInStage) return undefined;

    intervalRef.current = window.setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    return () => {
      window.clearInterval(intervalRef.current);
    };
  }, [paused, currentStageIndex, stages.length]);

  useEffect(() => {
    if (elapsed === 0) return;
    const nextStageIndex = stageIndexAt(elapsed);
    if (nextStageIndex >= stages.length) {
      finishSession();
      return;
    }
    if (nextStageIndex !== currentStageIndex) {
      setCurrentStageIndex(nextStageIndex);
    }
  }, [elapsed, stageIndexAt, stages.length, currentStageIndex]);

  useEffect(() => {
    if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
      attemptWakeLock();
      if (readyLamp) {
        sendLampColor(stages[currentStageIndex].color);
      }
    }
  }, [currentStageIndex, readyLamp, stages]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && intervalRef.current && !wakeLockRef.current) {
        attemptWakeLock();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const attemptWakeLock = async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
    } catch (error) {
      console.warn('Wake lock failed', error);
    }
  };

  const releaseWakeLock = async () => {
    if (!wakeLockRef.current) return;
    try {
      await wakeLockRef.current.release();
    } catch (error) {
      console.warn('Wake lock release failed', error);
    }
    wakeLockRef.current = null;
  };

  const buildRequestId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

  const goveeControl = async (capability) => {
    if (!readyLamp) return false;
    try {
      const res = await fetch('https://openapi.api.govee.com/router/api/v1/device/control', {
        method: 'POST',
        headers: {
          'Govee-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId: buildRequestId(),
          payload: {
            sku: deviceModel,
            device: deviceId,
            capability,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok && (data.code === 200 || data.code === 0);
    } catch (error) {
      console.warn('Govee control failed', error);
      return false;
    }
  };

  const sendLampColor = async (color) => {
    const colorHex = typeof color === 'string' ? color : rgbToHex(color);
    await goveeControl({
      type: 'devices.capabilities.color_setting',
      instance: 'colorRgb',
      value: rgbToInt(hexToRgb(colorHex)),
    });
  };

  const saveSettings = () => {
    setSaveStatus('Settings saved');
    window.setTimeout(() => setSaveStatus(''), 2500);
  };

  const goveeOn = async () => goveeControl({
    type: 'devices.capabilities.on_off',
    instance: 'powerSwitch',
    value: 1,
  });

  const goveeOff = async () => goveeControl({
    type: 'devices.capabilities.on_off',
    instance: 'powerSwitch',
    value: 0,
  });

  const startSession = async () => {
    setElapsed(0);
    setCurrentStageIndex(0);
    setSessionCount((count) => count + 1);
    setPaused(false);
    await attemptWakeLock();
    await goveeOn();
  };

  const finishSession = async () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    await releaseWakeLock();
    await goveeOff();
    setPaused(true);
    setElapsed(totalDuration);
    setCurrentStageIndex(stages.length);
  };

  const resetSession = () => {
    setElapsed(0);
    setCurrentStageIndex(-1);
    setPaused(false);
  };

  const togglePause = () => {
    setPaused((value) => !value);
  };

  const loadDevices = async () => {
    if (!apiKey) return;
    setLoadingDevices(true);
    setDevices([]);
    try {
      const res = await fetch('https://openapi.api.govee.com/router/api/v1/user/devices', {
        headers: {
          'Govee-API-Key': apiKey,
          accept: 'application/json',
        },
      });
      const data = await res.json();
      setDevices(data?.data || []);
    } catch (error) {
      console.warn('Load devices failed', error);
      setDevices([]);
    } finally {
      setLoadingDevices(false);
    }
  };

  const applyStageChange = (index, update) => {
    setStages((current) => {
      const next = [...current];
      next[index] = { ...next[index], ...update };
      return next;
    });
  };

  const currentView = currentStageIndex < 0 && elapsed === 0 ? 'idle' : currentStageIndex >= stages.length ? 'complete' : 'running';

  const stageName = activeStage?.name || 'Session';
  const stageTimeText = currentView === 'running'
    ? `${Math.floor(currentStageLeft / 60)}:${String(currentStageLeft % 60).padStart(2, '0')} remaining`
    : '';

  return (
    <div className="app" style={{ backgroundColor: currentView === 'running' ? activeColor : '#111318' }}>
      <div className="top-bar">
        <div className="wordmark">Rhythm</div>
        <div className="top-controls">
          <div className="session-badge">{sessionCount ? `Session ${sessionCount}` : ''}</div>
          <button className="help-btn" type="button" onClick={() => setHelpOpen(true)}>?</button>
        </div>
      </div>

      {currentView === 'idle' && (
        <div id="idleScreen" className="screen-center">
          <div className="idle-title">{Math.round(totalDuration / 60)} min session</div>
          <button type="button" className="start-ring" onClick={startSession}>
            <span className="main-label">Start</span>
            <span className="sub-label">Tap to begin</span>
          </button>
        </div>
      )}

      {currentView === 'running' && (
        <div id="runningScreen" className="screen-center">
          <div className={`lamp-toast ${colorIsLight(activeColor) ? 'dark' : ''}`}>
            {readyLamp ? 'Lamp connected' : 'Lamp offline — screen only'}
          </div>
          <div className="stage-name" style={{ color: activeDark ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)' }}>{stageName}</div>
          <div className="stage-time" style={{ color: activeDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.45)' }}>{stageTimeText}</div>
          <button type="button" className="pause-btn" onClick={togglePause}>{paused ? 'Resume' : 'Pause'}</button>
          <div className="arc-wrapper">
            <svg viewBox="0 0 80 80">
              <circle className="arc-bg" cx="40" cy="40" r="34" />
              <circle
                className={`arc-fill${activeDark ? ' dark' : ''}`}
                cx="40"
                cy="40"
                r="34"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={progressOffset}
              />
            </svg>
          </div>
          <div className="stage-dots">
            {stages.map((_, index) => (
              <div
                key={index}
                className={[
                  'dot',
                  activeDark ? 'dark' : '',
                  index === currentStageIndex ? 'active' : index < currentStageIndex ? 'done' : '',
                ].join(' ')}
              />
            ))}
          </div>
        </div>
      )}

      {currentView === 'complete' && (
        <div id="completeScreen" className="screen-center">
          <div className="complete-label">Session complete</div>
          <div className="complete-sub">Ready for next client</div>
          <button type="button" className="reset-ring" onClick={resetSession}>
            <span className="main-label">Start</span>
            <span className="sub-label">Next session</span>
          </button>
          <div className="auto-reset-count">Auto-ready in 12s</div>
        </div>
      )}

      <div className="lamp-indicator">
        <div className={`lamp-dot${readyLamp ? ' ok' : ''}`} />
        <span>{readyLamp ? 'Lamp ready' : 'Lamp not configured'}</span>
      </div>

      <button className="settings-btn" type="button" onClick={() => { setSettingsOpen(true); setSettingsTab('device'); }}>⚙</button>

      {settingsOpen && (
        <div id="settingsPanel" className="overlay">
          <div className="panel-card">
            <div className="settings-heading">
              <div>
                <div className="settings-title">Lamp Setup</div>
                <div className="settings-sub">Govee OpenAPI v1</div>
              </div>
              <div className="settings-tabs">
                <button type="button" className={`tab-button ${settingsTab === 'device' ? 'active' : ''}`} onClick={() => setSettingsTab('device')}>Device</button>
                <button type="button" className={`tab-button ${settingsTab === 'session' ? 'active' : ''}`} onClick={() => setSettingsTab('session')}>Session</button>
                <button type="button" className={`tab-button ${settingsTab === 'test' ? 'active' : ''}`} onClick={() => setSettingsTab('test')}>Test</button>
              </div>
            </div>

            {settingsTab === 'device' && (
              <>
                <div className="field">
                  <label>Govee API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                  <div className="hint">Govee app → Profile → About Us → Apply for API Key</div>
                </div>

                <button
                  className="btn-load-devices"
                  type="button"
                  disabled={!apiKey || loadingDevices}
                  onClick={loadDevices}
                >
                  {loadingDevices ? 'Loading…' : '↓ Load my devices'}
                </button>

                {devices.length > 0 && (
                  <div className="device-list">
                    {devices.map((device) => (
                      <button
                        key={device.device}
                        type="button"
                        className={`device-item${device.device === deviceId ? ' selected' : ''}`}
                        onClick={() => {
                          setDeviceId(device.device);
                          setDeviceModel(device.sku);
                        }}
                      >
                        <div>
                          <div className="dev-name">{device.deviceName || device.sku}</div>
                          <div className="dev-meta">{device.sku} · {device.device}</div>
                        </div>
                        <div className="dev-check">✓</div>
                      </button>
                    ))}
                  </div>
                )}

                <div className="field">
                  <label>Device ID</label>
                  <input
                    type="text"
                    value={deviceId}
                    onChange={(event) => setDeviceId(event.target.value)}
                    placeholder="3C:B1:DB:48:44:06:18:66"
                  />
                </div>

                <div className="field">
                  <label>Device Model (SKU)</label>
                  <input
                    type="text"
                    value={deviceModel}
                    onChange={(event) => setDeviceModel(event.target.value)}
                    placeholder="H6022"
                  />
                </div>
              </>
            )}

            {settingsTab === 'session' && (
              <div className="settings-section">
                <div className="settings-sub">Session stage settings</div>
                <StageSettings stages={stages} onChange={applyStageChange} />
              </div>
            )}

            {settingsTab === 'test' && (
              <div className="test-console open">
                <div className="test-console-title">Lamp Test Console</div>
                <div className="tc-row">
                  <button type="button" className="tc-btn" onClick={async () => { setTestStatus('Turning on…'); await goveeOn(); setTestStatus('✓ Lamp on'); }}>Turn On</button>
                  <button type="button" className="tc-btn" onClick={async () => { setTestStatus('Turning off…'); await goveeOff(); setTestStatus('✓ Lamp off'); }}>Turn Off</button>
                </div>
                <div className="tc-divider" />
                <div className="tc-row">
                  <div className="tc-swatch" style={{ backgroundColor: rgbToHex(testRgb) }} />
                  <div className="tc-rgb">
                    <div className="tc-slider-row">
                      <span className="tc-slider-label">R</span>
                      <input
                        className="tc-slider r"
                        type="range"
                        min="0"
                        max="255"
                        value={testRgb.r}
                        onChange={(event) => {
                          const next = { ...testRgb, r: Number(event.target.value) };
                          setTestRgb(next);
                          setTestColor(rgbToHex(next));
                        }}
                      />
                      <span className="tc-val">{testRgb.r}</span>
                    </div>
                    <div className="tc-slider-row">
                      <span className="tc-slider-label">G</span>
                      <input
                        className="tc-slider g"
                        type="range"
                        min="0"
                        max="255"
                        value={testRgb.g}
                        onChange={(event) => {
                          const next = { ...testRgb, g: Number(event.target.value) };
                          setTestRgb(next);
                          setTestColor(rgbToHex(next));
                        }}
                      />
                      <span className="tc-val">{testRgb.g}</span>
                    </div>
                    <div className="tc-slider-row">
                      <span className="tc-slider-label">B</span>
                      <input
                        className="tc-slider b"
                        type="range"
                        min="0"
                        max="255"
                        value={testRgb.b}
                        onChange={(event) => {
                          const next = { ...testRgb, b: Number(event.target.value) };
                          setTestRgb(next);
                          setTestColor(rgbToHex(next));
                        }}
                      />
                      <span className="tc-val">{testRgb.b}</span>
                    </div>
                  </div>
                </div>
                <button className="tc-send-btn" type="button" onClick={async () => { setTestStatus('Sending test color…'); await goveeOn(); await sendLampColor(testColor); setTestStatus('✓ Test color sent'); }}>Send Colour to Lamp</button>
                <div className={`tc-status ${testStatus.startsWith('✓') ? 'ok' : testStatus.startsWith('✗') ? 'fail' : ''}`}>{testStatus}</div>
              </div>
            )}

            <div className="btn-row">
              <button className="btn-save" type="button" onClick={saveSettings}>Save</button>
              <button className="btn-cancel" type="button" onClick={() => setSettingsOpen(false)}>Close</button>
            </div>
            {saveStatus && <div className="save-status">{saveStatus}</div>}
          </div>
        </div>
      )}

      {helpOpen && (
        <div id="helpPanel" className="overlay open">
          <div className="help-card">
            <div className="help-header">
              <div>
                <div className="settings-title">How to use Rhythm</div>
                <div className="settings-sub">App setup and workflow</div>
              </div>
              <button className="help-close" type="button" onClick={() => setHelpOpen(false)}>✕</button>
            </div>
           <ol className="help-list">
            <li>Open <strong>Settings</strong> to set up your Govee lamp, session times, and stage colors.</li>
            <li>Get your Govee API Key from the Govee app: <strong>Profile → About Us → Apply for API Key</strong>.</li>
            <li>Go to the <strong>Device</strong> tab, enter your API Key, and select your lamp. You can also add the device manually if needed.</li>
            <li>Go to the <strong>Session</strong> tab and set the time and color for each session stage.</li>
            <li>Open the <strong>Test</strong> tab to check that your lamp changes to the selected colors.</li>
            <li>Click <strong>Save Settings</strong> to store your preferences for future use.</li>
            <li>Press <strong>Start</strong> to begin your timer session.</li>
            <li>Use <strong>Pause</strong> anytime to pause the timer and continue later.</li>
            <li>After the session finishes, the app will show a completion message and start the ready countdown.</li>
            </ol>
            <div className="help-note">Tip: The timer works without the lamp, and the lamp color is optional.</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
