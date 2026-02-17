import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Settings, X, History, RefreshCw, Eye, EyeOff } from 'lucide-react';
import * as JsSIP from 'jssip';
import ThemeToggle from './ThemeToggle';

const Softphone: React.FC = () => {
    const [status, setStatus] = useState<'unregistered' | 'connecting' | 'registered'>('unregistered');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [isCalling, setIsCalling] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [callDuration, setCallDuration] = useState(0);
    const [showSettings, setShowSettings] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    // SIP Config State (Default values for demo, user should edit)
    const [sipConfig, setSipConfig] = useState({
        wsUrl: 'wss://10.0.3.164:8089/ws',
        domain: '10.0.3.164',
        extension: '105',
        password: 'secret'
    });

    const uaRef = useRef<any>(null);
    const sessionRef = useRef<any>(null);
    const timerRef = useRef<number | null>(null);
    const audioRemoteRef = useRef<HTMLAudioElement | null>(null);

    // Initialize UA
    const initUA = useCallback(() => {
        if (uaRef.current) {
            uaRef.current.stop();
        }

        const socket = new JsSIP.WebSocketInterface(sipConfig.wsUrl);
        const configuration = {
            sockets: [socket],
            uri: `sip:${sipConfig.extension}@${sipConfig.domain}`,
            password: sipConfig.password,
            display_name: `Extension ${sipConfig.extension}`
        };

        const ua = new JsSIP.UA(configuration);
        uaRef.current = ua;

        ua.on('connecting', () => setStatus('connecting'));
        ua.on('connected', () => console.log('SIP Connected'));
        ua.on('disconnected', () => setStatus('unregistered'));
        ua.on('registered', () => setStatus('registered'));
        ua.on('unregistered', () => setStatus('unregistered'));
        ua.on('registrationFailed', (e: any) => {
            console.error('Registration failed:', e.cause);
            setStatus('unregistered');
        });

        ua.on('newRTCSession', (data: any) => {
            const session = data.session;
            sessionRef.current = session;

            if (session.direction === 'incoming') {
                console.log('Incoming call');
                // Handle incoming call (auto-answer or show UI)
            }

            session.on('connecting', () => console.log('Call connecting'));
            session.on('peerconnection', () => console.log('Pair connection established'));

            session.on('accepted', () => {
                console.log('Call accepted');
                setIsCalling(true);
                startTimer();
            });

            session.on('ended', () => {
                console.log('Call ended');
                handleCallEnd();
            });

            session.on('failed', (e: any) => {
                console.error('Call failed:', e.cause);
                handleCallEnd();
            });

            session.on('addstream', (e: any) => {
                if (audioRemoteRef.current) {
                    audioRemoteRef.current.srcObject = e.stream;
                    audioRemoteRef.current.play();
                }
            });
        });

        ua.start();
    }, [sipConfig]);

    const handleCallEnd = () => {
        setIsCalling(false);
        stopTimer();
        setCallDuration(0);
        sessionRef.current = null;
    };

    const startTimer = () => {
        timerRef.current = window.setInterval(() => {
            setCallDuration(prev => prev + 1);
        }, 1000);
    };

    const stopTimer = () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleDial = (num: string) => {
        if (isCalling && sessionRef.current) {
            sessionRef.current.sendDTMF(num);
        }
        setPhoneNumber(prev => prev + num);
    };

    const makeCall = () => {
        if (!uaRef.current || status !== 'registered' || !phoneNumber) return;

        const options = {
            mediaConstraints: { audio: true, video: false },
            pcConfig: {
                iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
            }
        };

        uaRef.current.call(`sip:${phoneNumber}@${sipConfig.domain}`, options);
    };

    const hangupCall = () => {
        if (sessionRef.current) {
            sessionRef.current.terminate();
        }
    };

    const toggleMute = () => {
        if (sessionRef.current) {
            if (isMuted) {
                sessionRef.current.unmute();
            } else {
                sessionRef.current.mute();
            }
            setIsMuted(!isMuted);
        }
    };

    const clearNumber = () => {
        if (!isCalling) setPhoneNumber('');
    };

    const handleBackspace = () => {
        if (!isCalling) setPhoneNumber(prev => prev.slice(0, -1));
    };

    // Re-init UA when settings change
    useEffect(() => {
        // initUA(); // Commented out to prevent immediate connection in dev
        return () => {
            if (uaRef.current) uaRef.current.stop();
        };
    }, []);

    return (
        <div className="content-area">
            <header className="top-bar">
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Phone size={24} />
                    WebRTC Softphone
                </h1>
                <div className="actions">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '12px' }}>
                        <span className={`status-badge ${status}`}>
                            {status}
                        </span>
                        <button className="btn btn-icon" onClick={() => setShowSettings(!showSettings)} title="SIP Settings">
                            <Settings size={20} />
                        </button>
                    </div>

                    <ThemeToggle />

                    <button className="btn btn-icon" onClick={initUA} title="Reconnect SIP">
                        <RefreshCw size={20} className={status === 'connecting' ? 'animate-spin' : ''} />
                    </button>
                </div>
            </header>

            <div className="softphone-page-container">

                <div className={`settings-overlay ${showSettings ? 'show' : ''}`} onClick={() => setShowSettings(false)} />

                <div className={`softphone-settings ${showSettings ? 'open' : ''}`}>
                    <div className="settings-header">
                        <h3><Settings size={20} /> SIP Settings</h3>
                        <button className="btn btn-icon" onClick={() => setShowSettings(false)}>
                            <X size={20} />
                        </button>
                    </div>

                    <div className="settings-input-group">
                        <label className="settings-label">WebSocket URL</label>
                        <input
                            className="settings-input"
                            value={sipConfig.wsUrl}
                            onChange={e => setSipConfig({ ...sipConfig, wsUrl: e.target.value })}
                            placeholder="wss://..."
                        />
                    </div>

                    <div className="settings-input-group">
                        <label className="settings-label">Extension</label>
                        <input
                            className="settings-input"
                            value={sipConfig.extension}
                            onChange={e => setSipConfig({ ...sipConfig, extension: e.target.value })}
                            placeholder="100"
                        />
                    </div>

                    <div className="settings-input-group">
                        <label className="settings-label">Password</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type={showPassword ? "text" : "password"}
                                className="settings-input"
                                value={sipConfig.password}
                                onChange={e => setSipConfig({ ...sipConfig, password: e.target.value })}
                                style={{ paddingRight: '35px' }}
                                placeholder="SIP Secret"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{
                                    position: 'absolute',
                                    right: '8px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--text-muted)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '4px'
                                }}
                            >
                                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        </div>
                    </div>

                    <button
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: 'auto', padding: '14px' }}
                        onClick={() => {
                            initUA();
                            setShowSettings(false);
                        }}
                    >
                        Save & Connect
                    </button>
                </div>

                <div className="softphone-display">
                    <input
                        className="phone-number-input"
                        value={phoneNumber}
                        onChange={e => setPhoneNumber(e.target.value)}
                        placeholder="Dial Number"
                        readOnly={isCalling}
                    />
                    {isCalling && <div className="call-timer">{formatTime(callDuration)}</div>}
                    {!isCalling && phoneNumber && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Ready to call</div>
                    )}
                </div>

                <div className="dial-pad">
                    {[
                        ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
                        ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
                        ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
                        ['*', ''], ['0', '+'], ['#', '']
                    ].map(([num, sub]) => (
                        <button key={num} className="dial-btn" onClick={() => handleDial(num)}>
                            {num}
                            <span className="dial-sub">{sub}</span>
                        </button>
                    ))}
                </div>

                <div className="softphone-actions">
                    {isCalling ? (
                        <>
                            <button className="action-btn btn-util" onClick={toggleMute}>
                                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                            </button>
                            <button className="action-btn btn-hangup" onClick={hangupCall}>
                                <PhoneOff size={20} /> End
                            </button>
                        </>
                    ) : (
                        <>
                            <button className="action-btn btn-util" onClick={handleBackspace}>
                                <History size={18} />
                            </button>
                            <button className="action-btn btn-call" onClick={makeCall}>
                                <Phone size={20} /> Call
                            </button>
                            <button className="action-btn btn-util" onClick={clearNumber}>
                                <X size={18} />
                            </button>
                        </>
                    )}
                </div>

                {/* Remote Audio */}
                <audio ref={audioRemoteRef} autoPlay />
            </div>
        </div>
    );
};

export default Softphone;
