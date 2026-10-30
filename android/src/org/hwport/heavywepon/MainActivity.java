package org.hwport.heavyweapon;

import android.app.Activity;
import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/**
 * Hosts the HTML5 re-implementation of Heavy Weapon in a full-screen WebView.
 * Game files are served from the APK assets through a virtual https origin, and music is
 * played natively with MediaPlayer (gapless intro -> loop) to keep memory use low.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST + "/";

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private MediaPlayer intro, loop;
    private String musicName;
    private float musicVolume = 0.7f;
    private volatile boolean musicPaused;
    private volatile boolean activityPaused;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        Window w = getWindow();
        w.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            // draw into the notch area (LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES = 1)
            try {
                WindowManager.LayoutParams lp = w.getAttributes();
                lp.getClass().getField("layoutInDisplayCutoutMode").setInt(lp, 1);
                w.setAttributes(lp);
            } catch (Throwable ignored) { }
        }
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        initMusicThread();

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setTextZoom(100);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setHapticFeedbackEnabled(false);
        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new WebChromeClient() {
            /* no grey "play" placeholder before a cinematic's first frame: the default poster is a transparent pixel */
            @Override
            public Bitmap getDefaultVideoPoster() {
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.d("HW", m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "HWNative");
        setContentView(web);
        hideSystemUi();
        web.loadUrl(ORIGIN + "index.html");
    }

    private void hideSystemUi() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onPause() {
        super.onPause();
        activityPaused = true;
        if (web != null) {
            web.evaluateJavascript("window.HW && HW.onAppPause && HW.onAppPause()", null);
            web.onPause();
        }
        mh.post(new Runnable() { public void run() { if (stream != null) stream.setPaused(true); pauseMusicInternal(); } });
    }

    @Override
    protected void onResume() {
        super.onResume();
        activityPaused = false;
        hideSystemUi();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.HW && HW.onAppResume && HW.onAppResume()", null);
        }
        mh.post(new Runnable() { public void run() { if (!musicPaused && !activityPaused) { if (stream != null) stream.setPaused(false); resumeMusicInternal(); } } });
    }

    @Override
    protected void onDestroy() {
        mh.post(new Runnable() { public void run() {
            if (stream != null) { stream.stop(); stream = null; }
            releaseMusic();
            for (MediaPlayer mp : heads.values()) quietRelease(mp);
            heads.clear();
            musicThread.quitSafely();
        } });
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (web != null) web.evaluateJavascript("window.HW && HW.onBack && HW.onBack()", null);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    /* ------------------------------------------------------------------ music */
    /* Everything musical runs on its own thread so that preparing a track never holds up the screen.
       - Start-up cost: preparing a MediaPlayer takes a noticeable moment, so the first piece of every track (its intro,
         or the loop for tracks without one) is kept prepared in advance; playMusic() then only has to start() it and
         the rest of the chain is prepared after the music is already playing.
       - Gapless looping: MediaPlayer.setLooping() leaves an audible gap on many devices, so the loop is played by a
         chain of players - each one is handed the next prepared copy with setNextMediaPlayer() and a fresh copy is
         prepared whenever one finishes. The intro (if any) is chained in front the same way.
       - Fades: a fade-out moves the current players aside, turns them down step by step and releases them (the
         original's FadeOut at the boss warning and after the boss's last explosion). */
    private HandlerThread musicThread;
    private Handler mh;
    private MediaPlayer loopNext;
    private String loopPath;
    private int musicGen = 0;
    private final Map<String, MediaPlayer> heads = new HashMap<String, MediaPlayer>();
    private final Map<String, Boolean> headIntro = new HashMap<String, Boolean>();

    private void initMusicThread() {
        musicThread = new HandlerThread("hw-music");
        musicThread.start();
        mh = new Handler(musicThread.getLooper());
    }

    private MediaPlayer open(String path) {
        try {
            AssetFileDescriptor fd = getAssets().openFd(path);
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioStreamType(AudioManager.STREAM_MUSIC);
            mp.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
            fd.close();
            mp.setVolume(musicVolume, musicVolume);
            mp.prepare();
            return mp;
        } catch (Exception e) {
            android.util.Log.w("HW", "music " + path + ": " + e);
            return null;
        }
    }

    private static void quietRelease(MediaPlayer mp) {
        if (mp == null) return;
        try { mp.setOnCompletionListener(null); } catch (Exception ignored) { }
        try { mp.setNextMediaPlayer(null); } catch (Exception ignored) { }
        try { mp.release(); } catch (Exception ignored) { }
    }

    private static String headPath(String name, boolean hasIntro) {
        return "www/music/" + name + (hasIntro ? "_intro" : "") + ".ogg";
    }

    /* keep the opening piece of a track prepared (music thread) */
    private void prepareHead(String name) {
        if (heads.containsKey(name) || !headIntro.containsKey(name)) return;
        MediaPlayer mp = open(headPath(name, headIntro.get(name)));
        if (mp != null) heads.put(name, mp);
    }

    private void releaseMusic() {
        musicGen++;
        quietRelease(intro); intro = null;
        quietRelease(loop); loop = null;
        quietRelease(loopNext); loopNext = null;
    }

    /* prepare the copy that follows the current loop player and hook its hand-over */
    private void chainNext() {
        if (loop == null || loopPath == null) return;
        final int gen = musicGen;
        final MediaPlayer me = loop;
        loopNext = open(loopPath);
        if (gen != musicGen || loop != me) { quietRelease(loopNext); loopNext = null; return; }
        if (loopNext != null) {
            try { me.setNextMediaPlayer(loopNext); } catch (Exception ignored) { }
        }
        me.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
            @Override public void onCompletion(MediaPlayer mp) {
                if (gen != musicGen || loop != me) { quietRelease(mp); return; }
                loop = loopNext; loopNext = null;
                quietRelease(mp);
                if (loop != null) {
                    try { if (!loop.isPlaying() && !musicPaused && !activityPaused) loop.start(); } catch (Exception ignored) { }
                    chainNext();
                }
            }
        });
    }

    private void notifyStarted(final String name) {
        ui.post(new Runnable() { public void run() {
            if (web != null) web.evaluateJavascript("window.HW && HW.Audio && HW.Audio.onMusicStart && HW.Audio.onMusicStart('" + name + "')", null);
        } });
    }

    private void playMusicInternal(final String name, final boolean hasIntro, final boolean noLoop) {
        releaseMusic();
        musicName = name;
        musicPaused = false;
        if (name == null || name.length() == 0) return;
        headIntro.put(name, hasIntro);
        final int gen = musicGen;
        loopPath = "www/music/" + name + (hasIntro ? "_loop" : "") + ".ogg";
        // 1. the opening piece, ready in advance when possible, starts right away
        MediaPlayer head = heads.remove(name);
        if (head == null) head = open(headPath(name, hasIntro));
        if (head == null) return;
        try { head.setVolume(musicVolume, musicVolume); } catch (Exception ignored) { }
        if (hasIntro) intro = head; else loop = head;
        if (!activityPaused) {
            try { head.start(); } catch (Exception ignored) { }
        }
        notifyStarted(name);
        // 2. the rest of the chain is prepared while it plays
        mh.post(new Runnable() { public void run() {
            if (gen != musicGen) return;
            if (hasIntro) {
                loop = open(loopPath);
                if (gen != musicGen) { quietRelease(loop); loop = null; return; }
                if (loop != null && intro != null) {
                    try { intro.setNextMediaPlayer(loop); } catch (Exception ignored) { }
                    final MediaPlayer myIntro = intro;
                    intro.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                        @Override public void onCompletion(MediaPlayer mp) {
                            if (intro == myIntro) intro = null;
                            quietRelease(mp);
                            if (gen == musicGen && loop != null) {
                                try { if (!loop.isPlaying() && !musicPaused && !activityPaused) loop.start(); } catch (Exception ignored) { }
                            }
                        }
                    });
                } else if (loop != null && intro == null) {
                    // the intro already ended (very short): go straight on with the loop
                    try { if (!musicPaused && !activityPaused) loop.start(); } catch (Exception ignored) { }
                }
            }
            if (loop == null) return;
            if (noLoop) {
                // played once (the title's love theme): let it end and stay silent
                final MediaPlayer once = loop;
                once.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                    @Override public void onCompletion(MediaPlayer mp) { if (loop == once) loop = null; quietRelease(mp); }
                });
            } else chainNext();
        } });
        // 3. and a fresh opening piece is readied for the next time this track is wanted
        mh.postDelayed(new Runnable() { public void run() { prepareHead(name); } }, 1500);
    }

    /* the original's FadeOut: the current track is turned down to nothing over ms and then released */
    private void fadeOutInternal(int ms) {
        final MediaPlayer a = intro, b = loop, c = loopNext;
        musicGen++;
        intro = null; loop = null; loopNext = null; musicName = null;
        if (c != null) { try { if (b != null) b.setNextMediaPlayer(null); } catch (Exception ignored) { } quietRelease(c); }
        if (a == null && b == null) return;
        try { if (a != null) a.setOnCompletionListener(null); if (b != null) b.setOnCompletionListener(null); } catch (Exception ignored) { }
        final int steps = Math.max(1, ms / 50);
        final float v0 = musicVolume;
        mh.post(new Runnable() {
            int i = 0;
            public void run() {
                i++;
                float v = v0 * Math.max(0f, 1f - i / (float) steps);
                try { if (a != null) a.setVolume(v, v); } catch (Exception ignored) { }
                try { if (b != null) b.setVolume(v, v); } catch (Exception ignored) { }
                if (i >= steps) { quietRelease(a); quietRelease(b); }
                else mh.postDelayed(this, 50);
            }
        });
    }

    private void pauseMusicInternal() {
        try {
            if (intro != null && intro.isPlaying()) intro.pause();
            if (loop != null && loop.isPlaying()) loop.pause();
        } catch (Exception ignored) { }
    }

    private void resumeMusicInternal() {
        try {
            if (intro != null) intro.start();
            else if (loop != null) loop.start();
        } catch (Exception ignored) { }
    }

    private void setMusicVolumeInternal(float v) {
        musicVolume = v;
        try {
            if (intro != null) intro.setVolume(v, v);
            if (loop != null) loop.setVolume(v, v);
            if (loopNext != null) loopNext.setVolume(v, v);
        } catch (Exception ignored) { }
    }

    /* ------------------------------------------------------------------ gapless music stream
       MediaPlayer leaves a short silence every time a looping track goes round (its hand-over to the next player is
       not sample exact), which made the level music stop and start. The music is therefore played by its own
       streamer: MediaCodec decodes the OGG and an AudioTrack plays the PCM. The intro (if any) is played once, then
       the loop is decoded while it plays and kept in memory, and from the second time round it repeats straight from
       memory - sample exact, no seam at all. If anything in this fails before the music has started, the old
       MediaPlayer chain plays the track instead. */
    private MusicStream stream;

    final class MusicStream implements Runnable {
        final String name, introPath, loopPath;
        final boolean hasIntro, noLoop;
        volatile boolean stopped, paused, started;
        volatile float volume;
        volatile long fadeStart;
        volatile int fadeMs;
        AudioTrack track;
        int rate, chans;
        final ArrayList<short[]> cache = new ArrayList<short[]>();

        MusicStream(String name, boolean hasIntro, boolean noLoop, float vol, boolean paused) {
            this.name = name; this.hasIntro = hasIntro; this.noLoop = noLoop; this.volume = vol; this.paused = paused;
            introPath = hasIntro ? "www/music/" + name + "_intro.ogg" : null;
            loopPath = "www/music/" + name + (hasIntro ? "_loop" : "") + ".ogg";
        }
        void begin() {
            Thread t = new Thread(this, "hw-music-" + name);
            t.setDaemon(true);
            t.start();
        }
        void stop() {
            stopped = true;
            synchronized (this) { notifyAll(); }
            AudioTrack t = track;
            if (t != null) { try { t.pause(); t.flush(); } catch (Exception ignored) { } }
        }
        void setPaused(boolean p) {
            paused = p;
            AudioTrack t = track;
            if (t != null) { try { if (p) t.pause(); else t.play(); } catch (Exception ignored) { } }
            synchronized (this) { notifyAll(); }
        }
        void setVolume(float v) { volume = v; applyVolume(); }
        void fadeOut(int ms) { fadeStart = SystemClock.uptimeMillis(); fadeMs = Math.max(1, ms); }
        private float currentVolume() {
            if (fadeMs > 0) {
                float k = 1f - (SystemClock.uptimeMillis() - fadeStart) / (float) fadeMs;
                if (k <= 0f) { stopped = true; return 0f; }
                return volume * k;
            }
            return volume;
        }
        @SuppressWarnings("deprecation")
        private void applyVolume() {
            AudioTrack t = track;
            if (t == null) return;
            float v = currentVolume();
            try { t.setStereoVolume(v, v); } catch (Exception ignored) { }
        }
        private void format(int sr, int ch) {
            if (track != null && sr == rate && ch == chans) return;
            if (track != null) { try { track.release(); } catch (Exception ignored) { } track = null; }
            rate = sr; chans = ch;
            int mask = ch == 1 ? AudioFormat.CHANNEL_OUT_MONO : AudioFormat.CHANNEL_OUT_STEREO;
            int min = AudioTrack.getMinBufferSize(sr, mask, AudioFormat.ENCODING_PCM_16BIT);
            int size = Math.max(min * 2, sr * ch * 2 / 4);   // about a quarter of a second
            track = new AudioTrack(AudioManager.STREAM_MUSIC, sr, mask, AudioFormat.ENCODING_PCM_16BIT, size, AudioTrack.MODE_STREAM);
            applyVolume();
            if (!paused) track.play();
        }
        /* hand PCM to the track (blocking), in small pieces so that stop / pause / fades are noticed quickly */
        private boolean write(short[] s, int n) {
            int off = 0;
            while (off < n) {
                if (stopped) return false;
                while (paused && !stopped) { synchronized (this) { try { wait(250); } catch (InterruptedException ignored) { } } }
                applyVolume();
                if (stopped) return false;
                int w = track.write(s, off, Math.min(4096, n - off));
                if (w < 0) return false;
                off += w;
                if (!started && w > 0) { started = true; notifyStarted(name); }
            }
            return true;
        }
        /* decode one file to the end; with keep, every piece is also kept for the loop */
        private boolean decode(String path, boolean keep) throws Exception {
            AssetFileDescriptor fd = getAssets().openFd(path);
            MediaExtractor ex = new MediaExtractor();
            MediaCodec dec = null;
            try {
                ex.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
                MediaFormat f = ex.getTrackFormat(0);
                ex.selectTrack(0);
                dec = MediaCodec.createDecoderByType(f.getString(MediaFormat.KEY_MIME));
                dec.configure(f, null, null, 0);
                dec.start();
                format(f.getInteger(MediaFormat.KEY_SAMPLE_RATE), f.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                boolean inEos = false;
                while (!stopped) {
                    if (!inEos) {
                        int ii = dec.dequeueInputBuffer(2000);
                        if (ii >= 0) {
                            ByteBuffer ib = dec.getInputBuffer(ii);
                            int n = ex.readSampleData(ib, 0);
                            if (n < 0) { dec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inEos = true; }
                            else { dec.queueInputBuffer(ii, 0, n, ex.getSampleTime(), 0); ex.advance(); }
                        }
                    }
                    int oi = dec.dequeueOutputBuffer(info, 2000);
                    if (oi >= 0) {
                        if (info.size > 0) {
                            ByteBuffer ob = dec.getOutputBuffer(oi);
                            ob.position(info.offset);
                            ob.limit(info.offset + info.size);
                            short[] pcm = new short[info.size / 2];
                            ob.order(ByteOrder.nativeOrder()).asShortBuffer().get(pcm);
                            dec.releaseOutputBuffer(oi, false);
                            if (keep) cache.add(pcm);
                            if (!write(pcm, pcm.length)) return false;
                        } else dec.releaseOutputBuffer(oi, false);
                        if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return true;
                    } else if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        MediaFormat of = dec.getOutputFormat();
                        format(of.getInteger(MediaFormat.KEY_SAMPLE_RATE), of.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
                    }
                }
                return false;
            } finally {
                if (dec != null) { try { dec.stop(); } catch (Exception ignored) { } try { dec.release(); } catch (Exception ignored) { } }
                try { ex.release(); } catch (Exception ignored) { }
                try { fd.close(); } catch (Exception ignored) { }
            }
        }
        public void run() {
            try { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO); } catch (Throwable ignored) { }
            try {
                if (introPath != null && !decode(introPath, false)) return;
                if (noLoop) {
                    if (decode(loopPath, false) && !stopped) {
                        // let the last quarter second play out before the track is released
                        try { track.stop(); } catch (Exception ignored) { }
                        long until = SystemClock.uptimeMillis() + 400;
                        while (!stopped && SystemClock.uptimeMillis() < until) { synchronized (this) { try { wait(50); } catch (InterruptedException ignored) { } } }
                    }
                    return;
                }
                if (!decode(loopPath, true)) return;
                while (!stopped) {
                    for (int i = 0; i < cache.size(); i++) { short[] c = cache.get(i); if (!write(c, c.length)) return; }
                }
            } catch (Throwable e) {
                android.util.Log.w("HW", "music stream " + name + ": " + e);
                if (!started && !stopped) {
                    final MusicStream me = this;
                    mh.post(new Runnable() { public void run() {
                        if (stream == me) { stream = null; playMusicInternal(name, hasIntro, noLoop); }
                    } });
                }
            } finally {
                AudioTrack t = track;
                track = null;
                if (t != null) { try { t.pause(); t.flush(); } catch (Exception ignored) { } try { t.release(); } catch (Exception ignored) { } }
                cache.clear();
            }
        }
    }

    /* music thread: start a track on the streamer (the MediaPlayer chain is only the fallback) */
    private void playStream(String name, boolean hasIntro, boolean noLoop) {
        if (stream != null) { stream.stop(); stream = null; }
        releaseMusic();
        musicName = name;
        musicPaused = false;
        if (name == null || name.length() == 0) return;
        stream = new MusicStream(name, hasIntro, noLoop, musicVolume, activityPaused);
        stream.begin();
    }

    /* ------------------------------------------------------------------ JS bridge */
    class Bridge {
        @JavascriptInterface
        public void playMusic(final String name, final int hasIntro, final float vol) {
            // flags: 1 = the track has an intro part, 2 = play once (no loop)
            mh.post(new Runnable() { public void run() { musicVolume = vol; playStream(name, (hasIntro & 1) != 0, (hasIntro & 2) != 0); } });
        }
        @JavascriptInterface
        public void preloadMusic(final String list) {
            // "name:1,name2:0,..." (1 = the track has an intro part): ready the opening piece of each one
            mh.post(new Runnable() { public void run() {
                for (String it : list.split(",")) {
                    int c = it.indexOf(':');
                    if (c <= 0) continue;
                    String n = it.substring(0, c);
                    headIntro.put(n, it.substring(c + 1).equals("1"));
                }
                // (the streamer starts a track in a few milliseconds by itself: nothing has to be prepared ahead)
            } });
        }
        @JavascriptInterface
        public void fadeOutMusic(final int ms) {
            mh.post(new Runnable() { public void run() {
                if (stream != null) { stream.fadeOut(ms); stream = null; musicName = null; }
                fadeOutInternal(ms);
            } });
        }
        @JavascriptInterface
        public void stopMusic() {
            mh.post(new Runnable() { public void run() { musicName = null; if (stream != null) { stream.stop(); stream = null; } releaseMusic(); } });
        }
        @JavascriptInterface
        public void pauseMusic() {
            mh.post(new Runnable() { public void run() { musicPaused = true; if (stream != null) stream.setPaused(true); pauseMusicInternal(); } });
        }
        @JavascriptInterface
        public void resumeMusic() {
            mh.post(new Runnable() { public void run() { musicPaused = false; if (!activityPaused) { if (stream != null) stream.setPaused(false); resumeMusicInternal(); } } });
        }
        @JavascriptInterface
        public void setMusicVolume(final float v) {
            mh.post(new Runnable() { public void run() { if (stream != null) stream.setVolume(v); setMusicVolumeInternal(v); } });
        }
        @JavascriptInterface
        public void exitApp() {
            ui.post(new Runnable() { public void run() { finish(); } });
        }
        @JavascriptInterface
        public void vibrate(final int ms) {
            ui.post(new Runnable() { public void run() {
                try {
                    android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
                    if (v != null && v.hasVibrator()) v.vibrate(ms);
                } catch (Throwable ignored) { }
            } });
        }
    }

    /* ------------------------------------------------------------------ asset server */
    static final Map<String, String> MIME = new HashMap<String, String>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("ogg", "audio/ogg");
        MIME.put("wav", "audio/wav");
        MIME.put("svg", "image/svg+xml");
        MIME.put("mp4", "video/mp4");
    }

    class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            path = Uri.decode(path);
            String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
            String mime = MIME.get(ext);
            if (mime == null) mime = "application/octet-stream";
            try {
                AssetManager am = getAssets();
                InputStream in = am.open("www" + path, AssetManager.ACCESS_STREAMING);
                Map<String, String> headers = new HashMap<String, String>();
                headers.put("Access-Control-Allow-Origin", "*");
                headers.put("Cache-Control", "no-cache");
                String enc = (mime.startsWith("text/") || mime.equals("application/json")) ? "utf-8" : null;
                return new WebResourceResponse(mime, enc, 200, "OK", headers, in);
            } catch (Exception e) {
                Map<String, String> headers = new HashMap<String, String>();
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return url == null || !url.startsWith(ORIGIN);
        }
    }
}
