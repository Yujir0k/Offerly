"""Bounded VPS resource sampler. Writes only machine metrics, never configuration."""
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

output = Path('/opt/offerly/private/capacity-20261011.metrics.jsonl')

def cpu():
    parts = Path('/proc/stat').read_text().splitlines()[0].split()[1:9]
    values = list(map(int, parts))
    return sum(values), values[3] + values[4]

previous = cpu()
with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as out:
    for _ in range(60):
        raw = subprocess.check_output(['docker', 'stats', '--no-stream', '--format', '{{json .}}'], text=True)
        current = cpu()
        dt = current[0] - previous[0]
        host_cpu = 100 * (1 - (current[1] - previous[1]) / dt) if dt else 0
        previous = current
        memory = dict((line.split(':')[0], int(line.split()[1])) for line in Path('/proc/meminfo').read_text().splitlines())
        containers = []
        for line in raw.splitlines():
            row = json.loads(line)
            containers.append({key: row[key] for key in ['Name', 'CPUPerc', 'MemUsage', 'MemPerc', 'PIDs']})
        out.write(json.dumps({'unix': time.time(), 'hostCpuPercent': round(host_cpu, 2), 'availableMiB': round(memory['MemAvailable'] / 1024), 'loadAverage': os.getloadavg(), 'diskFreeGiB': round(shutil.disk_usage('/').free / 1024**3, 2), 'containers': containers}) + '\n')
        out.flush()
        time.sleep(2)
print('CAPACITY_MONITOR_COMPLETE')
