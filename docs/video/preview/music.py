"""Original 120 BPM synth score. No downloaded music or samples. NumPy required."""
import numpy as np, wave, sys
from pathlib import Path
sr=48000; duration=60; rng=np.random.default_rng(410); mix=np.zeros((sr*duration,2),dtype=np.float32)
def add(x,start,pan=0):
 a=int(start*sr);b=min(len(mix),a+len(x))
 if a<0 or b<=a:return
 gain=np.array([np.sqrt((1-pan)/2),np.sqrt((1+pan)/2)],dtype=np.float32)
 mix[a:b]+=x[:b-a,None]*gain

def tone(midi,dur,vol,kind='pluck'):
 t=np.arange(int(sr*dur))/sr;f=440*2**((midi-69)/12)
 if kind=='pad':
  x=(np.sin(2*np.pi*f*t)+.23*np.sin(2*np.pi*f*1.002*t)+.12*np.sin(4*np.pi*f*t))
  env=np.minimum(t/.3,1)*np.minimum((dur-t)/.7,1)
 else:
  x=np.sin(2*np.pi*f*t+1.7*np.sin(2*np.pi*f*2*t)*np.exp(-t*15))+.15*np.sin(4*np.pi*f*t)
  env=(1-np.exp(-t*280))*np.exp(-t*(9 if kind=='pluck' else 3.5))
 return (x*env*vol).astype(np.float32)
chords=[[54,61,64,68],[50,57,61,66],[45,52,59,61],[52,59,64,66]]
for bar in range(30):
 chord=chords[(bar//2)%4];start=bar*2
 for k,n in enumerate(chord):add(tone(n+12,3,.055,'pad'),start,(-1 if k%2 else 1)*.45)
 if bar>=3 and bar<28:
  for beat in range(4):
   t=np.arange(int(.32*sr))/sr;freq=44+100*np.exp(-t*42);phase=2*np.pi*np.cumsum(freq)/sr
   kick=np.sin(phase)*(1-np.exp(-t*400))*np.exp(-t*17)*.43
   add(kick,start+beat*.5)
   if beat in (1,3):
    t=np.arange(int(.18*sr))/sr;noise=rng.normal(0,1,len(t));smooth=np.convolve(noise,np.ones(12)/12,mode='same')
    clap=(noise-smooth)*np.exp(-t*35)*.07;add(clap,start+beat*.5,.12)
  for eighth in range(8):
   t=np.arange(int(.06*sr))/sr;noise=rng.normal(0,1,len(t));hat=np.diff(noise,prepend=0)*np.exp(-t*80)*(.019 if eighth%2 else .012)
   add(hat,start+eighth*.25,.35 if eighth%2 else -.35)
  for k in [0,3,4,6]:add(tone(chord[0]-12,.55,.23,'bass'),start+k*.25)
 if bar>=2 and bar<28:
  pattern=[0,2,1,3,2,1,3,2]
  for k in ([0,3,5] if bar<6 else [0,2,3,5,6,7]):
   n=chord[pattern[k]]+24;note=tone(n,.7,.115)
   add(note,start+k*.25,(-.3 if k%2 else .3));add(note*.22,start+k*.25+.375,.5)
# Restrained filtered whooshes at chapter changes.
for at in [4,10,15,20,31,36,41,47,55]:
 t=np.arange(int(.6*sr))/sr;noise=rng.normal(0,1,len(t));sm=np.convolve(noise,np.ones(50)/50,mode='same')
 add((sm*np.sin(np.pi*t/.6)**2*.09).astype(np.float32),at-.3,-.2)
# Resolve and make space for the closing brand.
for n in [54,61,64,68,73]:add(tone(n,5,.08,'pad'),54)
fade=np.minimum(np.arange(len(mix))/sr/1.2,1)*np.minimum((duration-np.arange(len(mix))/sr)/2.2,1)
mix=np.tanh(mix*1.3)*fade[:,None];peak=np.max(np.abs(mix));mix*=.84/max(peak,.01)
p=Path(sys.argv[1]);p.parent.mkdir(parents=True,exist_ok=True)
with wave.open(str(p),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((mix*32767).astype('<i2').tobytes())
print({'duration':60,'bpm':120,'peak':float(np.max(np.abs(mix))),'path':str(p)})
