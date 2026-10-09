"""Mirror desktop process output to screen and persistent log."""
import sys,subprocess,argparse
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--project',required=True);p.add_argument('--data',required=True);p.add_argument('--output',required=True);a=p.parse_args()
folder=Path(a.output)
if (folder/'35-run-summary.json').exists():
    print('Completed run is preserved. Use a new --output; the historical log is unchanged.',flush=True)
    sys.exit(1)
folder.mkdir(parents=True,exist_ok=True)
with (folder/'35-desktop-review.log').open('a',encoding='utf-8') as log:
    process=subprocess.Popen([sys.executable,'-u',str(Path(__file__).with_name('step35_desktop_review.py')),'--project',a.project,'--data',a.data,'--output',a.output],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace',env={**__import__('os').environ,'PYTHONIOENCODING':'utf-8'})
    for line in process.stdout:print(line,end='',flush=True);log.write(line);log.flush()
    sys.exit(process.wait())
