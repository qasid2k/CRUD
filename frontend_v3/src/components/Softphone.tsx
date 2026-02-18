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
    const [callStatus, setCallStatus] = useState<'idle' | 'dialing' | 'ringing' | 'active' | 'incoming'>('idle');
    const [incomingCaller, setIncomingCaller] = useState<string>('');
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
    const ringtoneCtxRef = useRef<AudioContext | null>(null);

    // Initialize UA
    const initUA = useCallback(() => {
        // If already registered, don't restart
        if (uaRef.current && uaRef.current.isRegistered()) {
            return;
        }

        if (uaRef.current) {
            uaRef.current.stop();
        }

        const socket = new JsSIP.WebSocketInterface(sipConfig.wsUrl);
        const configuration = {
            sockets: [socket],
            uri: `sip:${sipConfig.extension}@${sipConfig.domain}`,
            password: sipConfig.password,
            display_name: `Extension ${sipConfig.extension}`,
            register: true,
            register_expires: 600,
            session_timers: true,
            connection_recovery_min_interval: 5,
            connection_recovery_max_interval: 30
        };

        const ua = new JsSIP.UA(configuration);
        uaRef.current = ua;

        ua.on('connecting', () => setStatus('connecting'));
        ua.on('connected', () => console.log('SIP Connected'));
        ua.on('registered', () => {
            console.log('SIP Registered Successfully');
            setStatus('registered');
        });

        ua.on('registrationFailed', (e: any) => {
            console.error('Registration failed:', e.cause);
            setStatus('unregistered');
        });

        ua.on('newRTCSession', (data: any) => {
            const session = data.session;
            sessionRef.current = session;

            if (session.direction === 'incoming') {
                setCallStatus('incoming');
                setIncomingCaller(session.remote_identity.display_name || session.remote_identity.uri.user);
            }

            session.on('peerconnection', (data: any) => {
                const pc = data.peerconnection;
                pc.ontrack = (e: RTCTrackEvent) => {
                    if (audioRemoteRef.current) {
                        const remoteStream = e.streams[0] || new MediaStream([e.track]);
                        audioRemoteRef.current.srcObject = remoteStream;
                        audioRemoteRef.current.play().catch(console.warn);
                    }
                };
            });

            session.on('connecting', () => {
                if (session.direction === 'outgoing') setCallStatus('dialing');
            });
            session.on('progress', () => {
                if (session.direction === 'outgoing') setCallStatus('ringing');
            });

            session.on('accepted', () => {
                setCallStatus('active');
                setIsCalling(true);
                startTimer();
            });

            session.on('confirmed', () => setCallStatus('active'));
            session.on('ended', () => handleCallEnd());
            session.on('failed', (e: any) => {
                console.error('Call failed:', e.cause);
                handleCallEnd();
            });
        });

        ua.start();
    }, [sipConfig]);

    const handleCallEnd = () => {
        setIsCalling(false);
        setCallStatus('idle');
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

    const playRingtone = () => {
        if (ringtoneCtxRef.current) return;

        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        ringtoneCtxRef.current = ctx;

        const playPulse = (startTime: number) => {
            if (!ringtoneCtxRef.current) return;

            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gainNode = ctx.createGain();

            osc1.type = 'sine';
            osc2.type = 'sine';
            osc1.frequency.setValueAtTime(440, startTime);
            osc2.frequency.setValueAtTime(480, startTime);

            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(0.2, startTime + 0.1);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.8);

            osc1.connect(gainNode);
            osc2.connect(gainNode);
            gainNode.connect(ctx.destination);

            osc1.start(startTime);
            osc2.start(startTime);
            osc1.stop(startTime + 2);
            osc2.stop(startTime + 2);
        };

        // Ring pattern: 2 seconds on, 2 seconds off
        let time = ctx.currentTime;
        const interval = setInterval(() => {
            if (!ringtoneCtxRef.current) {
                clearInterval(interval);
                return;
            }
            playPulse(ctx.currentTime);
        }, 4000);

        playPulse(time); // Initial ring
    };

    const stopRingtone = () => {
        if (ringtoneCtxRef.current) {
            ringtoneCtxRef.current.close();
            ringtoneCtxRef.current = null;
        }
    };

    useEffect(() => {
        if (callStatus === 'incoming') {
            playRingtone();
        } else {
            stopRingtone();
        }
        return () => stopRingtone();
    }, [callStatus]);

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
                iceServers: [
                    { urls: ['stun:stun.l.google.com:19302'] },
                    { urls: ['stun:stun1.l.google.com:19302'] }
                ],
                // Force faster ICE gathering
                iceCandidatePoolSize: 10
            },
            rtcOfferConstraints: {
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            },
            // Reduce the time the browser waits for ICE candidates
            // Default is often 5-10 seconds; we reduce it for a snappier feel
            iceGatheringTimeout: 1000
        };

        uaRef.current.call(`sip:${phoneNumber}@${sipConfig.domain}`, options);
    };

    const hangupCall = () => {
        if (sessionRef.current) {
            sessionRef.current.terminate();
        }
    };

    const answerCall = () => {
        if (sessionRef.current && callStatus === 'incoming') {
            sessionRef.current.answer({
                mediaConstraints: { audio: true, video: false }
            });
        }
    };

    const rejectCall = () => {
        if (sessionRef.current && callStatus === 'incoming') {
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

    // Init UA when component mounts
    useEffect(() => {
        initUA();
        return () => {
            if (uaRef.current) uaRef.current.stop();
        };
    }, [initUA]);

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
                        className={`phone-number-input ${callStatus === 'ringing' || callStatus === 'incoming' ? 'ringing-pulse' : ''}`}
                        value={callStatus === 'incoming' ? `📞 ${incomingCaller}` : phoneNumber}
                        onChange={e => setPhoneNumber(e.target.value)}
                        placeholder="Dial Number"
                        readOnly={isCalling || callStatus !== 'idle'}
                    />
                    {isCalling && <div className="call-timer">{formatTime(callDuration)}</div>}
                    <div style={{
                        color: callStatus === 'ringing' || callStatus === 'incoming' ? 'var(--accent)' :
                            callStatus === 'active' ? 'var(--success)' :
                                callStatus === 'dialing' ? 'var(--primary)' : 'var(--text-muted)',
                        fontSize: '13px',
                        fontWeight: 600,
                        marginTop: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        justifyContent: 'center',
                        height: '20px'
                    }}>
                        {callStatus === 'dialing' && <RefreshCw size={14} className="animate-spin" />}
                        {callStatus === 'dialing' && 'Connecting...'}
                        {callStatus === 'ringing' && '🔔 Ringing...'}
                        {callStatus === 'incoming' && '📱 Incoming Call...'}
                        {callStatus === 'active' && '📞 Call Active'}
                        {callStatus === 'idle' && phoneNumber && 'Ready to call'}
                    </div>
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
                    {callStatus === 'incoming' ? (
                        <>
                            <button className="action-btn btn-hangup" onClick={rejectCall} style={{ flex: 1 }}>
                                <PhoneOff size={20} /> Reject
                            </button>
                            <button className="action-btn btn-call" onClick={answerCall} style={{ flex: 1 }}>
                                <Phone size={20} /> Answer
                            </button>
                        </>
                    ) : (callStatus === 'dialing' || callStatus === 'ringing' || callStatus === 'active') ? (
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

                {/* Remote Audio - PlaysInline is critical for mobile and some desktop browsers */}
                <audio ref={audioRemoteRef} playsInline />
            </div>
        </div>
    );
};

export default Softphone;
