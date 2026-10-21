"""Encode the recorded browser video, omitting setup/navigation between chapters."""
import hashlib
import json
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parent
data = json.loads((root / 'observations.json').read_text())
edits = data['edits']
start, before_end, after_start = edits['start'], edits['beforeEnd'], edits['afterStart']
filters = (f'[0:v]trim=start={start}:end={before_end},setpts=PTS-STARTPTS[before];'
           f'[0:v]trim=start={after_start},setpts=PTS-STARTPTS[after];'
           '[before][after]concat=n=2:v=1:a=0[video]')
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(root / 'pr-26-demo.webm'),
                '-filter_complex', filters, '-map', '[video]', '-c:v', 'libx264', '-preset', 'medium',
                '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(root / 'demo.mp4')], check=True)
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', str(root / 'demo.mp4')]))
def final_time(seconds):
    return round(seconds - start - (after_start - before_end if seconds >= after_start else 0), 2)
video = {'duration': float(probe['format']['duration']), 'bytes': int(probe['format']['size']),
         'sha256': hashlib.sha256((root / 'demo.mp4').read_bytes()).hexdigest(),
         'moments': [{**moment, 'finalSeconds': final_time(moment['seconds'])} for moment in data['moments']],
         'observations': [{**observation, 'finalSeconds': final_time(observation['seconds'])} for observation in data['observations']]}
(root / 'video.json').write_text(json.dumps(video, indent=2) + '\n')
for name, seconds in [('before-card', 1.2), ('after-card', final_time(after_start) + 1.2)]:
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(seconds), '-i', str(root / 'demo.mp4'),
                    '-frames:v', '1', str(root / f'{name}.png')], check=True)
print(json.dumps(video))
