import importlib.util
p='/tmp/ea/custom_components/energy_attribution/training.py'
s=importlib.util.spec_from_file_location('training',p)
import sys
m=importlib.util.module_from_spec(s); sys.modules['training']=m; s.loader.exec_module(m)
TrainingEngine=m.TrainingEngine

def feed(e,start,values,step=1):
    for i,v in enumerate(values): e.add_sample(start+i*step,v)

def test_quick_consistent():
    e=TrainingEngine('quick',baseline_window_s=3,stable_window_s=1,min_event_w=30)
    feed(e,0,[100]*5+[100,210,210,210,100,100,100]+[100,210,210,210,100,100,100])
    r=e.result(); assert r['completed']; assert 100<=r['peak_delta_w']<=120; assert r['events_detected']==2

def test_quick_inconsistent():
    e=TrainingEngine('quick',baseline_window_s=3,stable_window_s=1,min_event_w=30)
    feed(e,0,[100]*5+[100,210,210,210,100,100,100]+[100,260,260,260,100,100,100])
    assert not e.result()['completed']

def test_full():
    e=TrainingEngine('full_cycle',baseline_window_s=3,idle_window_s=3,full_cycle_min_active_s=5,min_event_w=30)
    feed(e,0,[100]*5+[180]*8+[300]*5+[160]*3+[100]*5)
    r=e.result(); assert r['completed']; assert r['peak_delta_w']>=190; assert r['energy_wh']>0
