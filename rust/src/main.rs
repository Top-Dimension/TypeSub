use std::io::{self, BufRead, Write};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
struct Settings {
    interval_ms: u64,
    pinyin: bool,
    tone: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            interval_ms: 45,
            pinyin: true,
            tone: true,
        }
    }
}

enum Command {
    Start(String),
    Partial(String),
    Stop,
    Settings(Settings),
    Shutdown,
}

struct Timeline {
    chars: Vec<char>,
    visible: usize,
    next: Instant,
    interval: Duration,
    completed: bool,
}

impl Timeline {
    fn new(text: String, now: Instant, settings: &Settings) -> Self {
        Self {
            chars: text.chars().collect(),
            visible: 0,
            next: now,
            interval: Duration::from_millis(settings.interval_ms.clamp(20, 200)),
            completed: false,
        }
    }

    fn partial(&mut self, text: String, now: Instant) {
        let next: Vec<char> = text.chars().collect();
        let stable = self
            .chars
            .iter()
            .zip(&next)
            .take_while(|(a, b)| a == b)
            .count();
        self.visible = self.visible.min(stable);
        self.chars = next;
        self.completed = false;
        self.next = now;
    }

    fn advance(&mut self, now: Instant) -> bool {
        let before = self.visible;
        let lag = now.saturating_duration_since(self.next);
        if lag > Duration::from_millis(1200) {
            self.visible = self.chars.len();
        } else {
            while self.visible < self.chars.len() && now >= self.next {
                self.visible += 1;
                let pause = if matches!(
                    self.chars[self.visible - 1],
                    '，' | '。' | '？' | '！' | ',' | '?' | '!'
                ) {
                    Duration::from_millis(180)
                } else {
                    Duration::ZERO
                };
                self.next += self.interval + pause;
            }
        }
        self.completed = self.visible == self.chars.len();
        before != self.visible
    }

    fn visible_text(&self) -> String {
        self.chars.iter().take(self.visible).collect()
    }

    fn timeout(&self) -> Duration {
        if self.completed {
            Duration::from_secs(3600)
        } else {
            self.next.saturating_duration_since(Instant::now())
        }
    }
}

fn escape_json(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '"' => result.push_str("\\\""),
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            control if control < ' ' => {
                use std::fmt::Write as _;
                let _ = write!(result, "\\u{:04x}", control as u32);
            }
            other => result.push(other),
        }
    }
    result
}

fn pinyin_for(text: &str, tone: bool) -> Vec<String> {
    text.chars()
        .map(|ch| {
            let pair = match ch {
                '银' => ("yín", "yin"),
                '行' => ("háng", "hang"),
                '长' => ("zhǎng", "zhang"),
                '你' => ("nǐ", "ni"),
                '好' => ("hǎo", "hao"),
                '欢' => ("huān", "huan"),
                '迎' => ("yíng", "ying"),
                '来' => ("lái", "lai"),
                '到' => ("dào", "dao"),
                '我' => ("wǒ", "wo"),
                '们' => ("men", "men"),
                '的' => ("de", "de"),
                '直' => ("zhí", "zhi"),
                '播' => ("bō", "bo"),
                '间' => ("jiān", "jian"),
                '说' => ("shuō", "shuo"),
                '话' => ("huà", "hua"),
                '字' => ("zì", "zi"),
                '幕' => ("mù", "mu"),
                '正' => ("zhèng", "zheng"),
                '在' => ("zài", "zai"),
                '逐' => ("zhú", "zhu"),
                '个' => ("gè", "ge"),
                '出' => ("chū", "chu"),
                '现' => ("xiàn", "xian"),
                '今' => ("jīn", "jin"),
                '天' => ("tiān", "tian"),
                '气' => ("qì", "qi"),
                '很' => ("hěn", "hen"),
                '不' => ("bù", "bu"),
                '错' => ("cuò", "cuo"),
                '测' => ("cè", "ce"),
                '试' => ("shì", "shi"),
                '这' => ("zhè", "zhe"),
                '是' => ("shì", "shi"),
                '一' => ("yī", "yi"),
                '段' => ("duàn", "duan"),
                '文' => ("wén", "wen"),
                '本' => ("běn", "ben"),
                '语' => ("yǔ", "yu"),
                '音' => ("yīn", "yin"),
                '识' => ("shí", "shi"),
                '别' => ("bié", "bie"),
                '模' => ("mó", "mo"),
                '型' => ("xíng", "xing"),
                '安' => ("ān", "an"),
                '装' => ("zhuāng", "zhuang"),
                '完' => ("wán", "wan"),
                '成' => ("chéng", "cheng"),
                '开' => ("kāi", "kai"),
                '始' => ("shǐ", "shi"),
                '关' => ("guān", "guan"),
                '闭' => ("bì", "bi"),
                '组' => ("zǔ", "zu"),
                '件' => ("jiàn", "jian"),
                _ => ("", ""),
            };
            (if tone { pair.0 } else { pair.1 }).to_string()
        })
        .collect()
}

fn emit(timeline: Option<&Timeline>, settings: &Settings) {
    let text = timeline.map(Timeline::visible_text).unwrap_or_default();
    let syllables = if settings.pinyin {
        pinyin_for(&text, settings.tone)
    } else {
        Vec::new()
    };
    let syllables = syllables
        .iter()
        .map(|s| format!("\"{}\"", escape_json(s)))
        .collect::<Vec<_>>()
        .join(",");
    println!(
        "{{\"event\":\"frame\",\"typed\":\"{}\",\"syllables\":[{}],\"cursor\":{}}}",
        escape_json(&text),
        syllables,
        timeline.is_some()
    );
    let _ = io::stdout().flush();
}

fn reader() -> Receiver<Command> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for line in io::stdin().lock().lines().map_while(Result::ok) {
            let mut parts = line.splitn(2, '\t');
            let command = match parts.next().unwrap_or_default() {
                "start" => Command::Start(parts.next().unwrap_or_default().to_string()),
                "partial" => Command::Partial(parts.next().unwrap_or_default().to_string()),
                "stop" | "clear" => Command::Stop,
                "shutdown" => {
                    let _ = tx.send(Command::Shutdown);
                    break;
                }
                "settings" => {
                    let mut settings = Settings::default();
                    for pair in parts.next().unwrap_or_default().split(';') {
                        let mut kv = pair.splitn(2, '=');
                        match kv.next().unwrap_or_default() {
                            "minInterval" => {
                                settings.interval_ms =
                                    kv.next().unwrap_or("45").parse().unwrap_or(45)
                            }
                            "pinyin" => settings.pinyin = kv.next().unwrap_or("1") == "1",
                            "tone" => settings.tone = kv.next().unwrap_or("1") == "1",
                            _ => {}
                        }
                    }
                    Command::Settings(settings)
                }
                _ => continue,
            };
            if tx.send(command).is_err() {
                break;
            }
        }
        let _ = tx.send(Command::Shutdown);
    });
    rx
}

fn main() {
    let rx = reader();
    let mut settings = Settings::default();
    let mut timeline: Option<Timeline> = None;
    println!("{{\"event\":\"ready\"}}");
    let _ = io::stdout().flush();
    loop {
        let timeout = timeline
            .as_ref()
            .map(Timeline::timeout)
            .unwrap_or(Duration::from_secs(3600));
        match rx.recv_timeout(timeout) {
            Ok(Command::Start(text)) => {
                timeline = Some(Timeline::new(text, Instant::now(), &settings));
                emit(timeline.as_ref(), &settings);
            }
            Ok(Command::Partial(text)) => {
                if let Some(active) = &mut timeline {
                    active.partial(text, Instant::now());
                } else {
                    timeline = Some(Timeline::new(text, Instant::now(), &settings));
                }
                emit(timeline.as_ref(), &settings);
            }
            Ok(Command::Stop) => {
                timeline = None;
                emit(None, &settings);
            }
            Ok(Command::Settings(next)) => {
                settings = next;
                if let Some(active) = &mut timeline {
                    active.interval = Duration::from_millis(settings.interval_ms.clamp(20, 200));
                }
                emit(timeline.as_ref(), &settings);
            }
            Ok(Command::Shutdown) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {
                if let Some(active) = &mut timeline {
                    if active.advance(Instant::now()) {
                        emit(timeline.as_ref(), &settings);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_monotonic_deadlines() {
        let now = Instant::now();
        let mut timeline = Timeline::new("你好。".into(), now, &Settings::default());
        assert!(timeline.advance(now));
        assert_eq!(timeline.visible_text(), "你");
        assert!(!timeline.advance(now + Duration::from_millis(44)));
        assert!(timeline.advance(now + Duration::from_millis(45)));
        assert_eq!(timeline.visible_text(), "你好");
        assert!(timeline.advance(now + Duration::from_millis(90)));
        assert_eq!(timeline.visible_text(), "你好。");
    }

    #[test]
    fn catches_up_after_long_lag() {
        let now = Instant::now();
        let mut timeline = Timeline::new("一段测试文本".into(), now, &Settings::default());
        assert!(timeline.advance(now + Duration::from_millis(1300)));
        assert_eq!(timeline.visible_text(), "一段测试文本");
    }

    #[test]
    fn partial_keeps_only_stable_prefix() {
        let now = Instant::now();
        let mut timeline = Timeline::new("欢迎来到".into(), now, &Settings::default());
        timeline.advance(now + Duration::from_millis(100));
        timeline.partial("欢迎来玩".into(), now + Duration::from_millis(100));
        assert_eq!(timeline.visible_text(), "欢迎来");
    }

    #[test]
    fn pinyin_preserves_character_alignment() {
        assert_eq!(
            pinyin_for("银行行长1999", true),
            ["yín", "háng", "háng", "zhǎng", "", "", "", ""]
        );
    }

    #[test]
    fn escapes_control_characters() {
        assert_eq!(escape_json("a\"\n\\b"), "a\\\"\\n\\\\b");
    }
}
