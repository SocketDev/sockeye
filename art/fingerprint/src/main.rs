use fframes::{AudioMap, Duration, FFramesContext, Frame, RenderOptions, Svgr, Video};
use fframes_skia_renderer::cli::SkiaRenderers;

struct FingerprintVideo {
    frames: Vec<String>,
    track: String,
}

impl Video for FingerprintVideo {
    const BACKGROUND_COLOR: fframes::Color = fframes::Color::TRANSPARENT;
    const FPS: usize = 30;
    const WIDTH: usize = 256;
    const HEIGHT: usize = 256;

    fn duration(&self) -> Duration<'_> { Duration::Seconds(self.frames.len() as f32 / 30.0) }
    fn audio(&self) -> AudioMap<'_> { AudioMap::none() }
    fn render_frame(&self, frame: Frame, ctx: &FFramesContext) -> Svgr<'_> {
        let ink = self.frames.get(frame.index).map(String::as_str).unwrap_or("");
        fframes::svgr!(
            <svg xmlns="http://www.w3.org/2000/svg" width={ctx.current_video_size.width} height={ctx.current_video_size.height} viewBox="0 0 256 256">
                <g transform="translate(0 256) scale(0.1 -0.1)">
                    <path d={self.track.as_str()} fill="#b8b8b8" />
                    <path d={self.track.as_str()} fill="#ff3b30" opacity={frame.animate(fframes::timeline!(
                        at 1.5 => 1.85, animate 0.0 => 1.0, fframes::animation::Easing::EaseOut,
                    ))} />
                    <path d={ink} fill="#ff3b30" />
                </g>
            </svg>
        )
    }
}

fn main() -> std::process::ExitCode {
    let input: serde_json::Value = serde_json::from_str(include_str!("../scan.json")).unwrap();
    let video = FingerprintVideo {
        frames: input["frames"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_owned()).collect(),
        track: input["track"].as_str().unwrap().to_owned(),
    };
    fframes::cli::new(&video, RenderOptions::default()).renderers(SkiaRenderers::default()).run()
}
