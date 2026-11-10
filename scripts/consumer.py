"""Independent installed rebuilt-wheel consumer outside checkout; no test imports."""
from fractions import Fraction
from pathlib import Path
import hashlib
import importlib.metadata
import json
import math
import platform
import resource
import shutil
import time

import numpy as np
from sklearn.decomposition import PCA
from threadpoolctl import threadpool_info
import neighborhood_projection_studio as sdk
from neighborhood_projection_studio import core, types as dto

package = Path(sdk.__file__).parent
assert str(package).startswith('/opt/neighborhood-runtime/')
assert not Path('/work').exists() and not Path('/probe').exists()
for name in ['pytest', 'build', 'setuptools', 'wheel']:
    try: importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError: pass
    else: raise AssertionError('Unexpected build/test package '+name)
assert all(shutil.which(name) is None for name in ['cc','gcc','g++','make'])
module_hashes = json.loads(Path('/consumer/module-hashes.json').read_text())
for name, expected in module_hashes.items():
    assert hashlib.sha256((package.parent/name).read_bytes()).hexdigest()==expected
notice = json.loads(Path('/consumer/notice-inventory.json').read_text())
for item in notice['files']:
    assert hashlib.sha256((package/'_notices'/item['path']).read_bytes()).hexdigest()==item['sha256']
# Real fit observation; no replacement predictions, scores or spectrum.
fits = []
class ObservedPCA(PCA):
    def fit_transform(self, X, y=None):
        fits.append({'shape':list(X.shape), 'threads':[x['num_threads'] for x in threadpool_info()],
                     'params':{k:self.get_params()[k] for k in ['n_components','svd_solver','whiten','copy']}})
        return super().fit_transform(X, y=y)
core.PCA = ObservedPCA
values = np.random.default_rng(42).normal(size=(64,8))*np.arange(1,9)
ids = [f'p{i:04d}' for i in range(64)]
result = sdk.analyze_projection(ids,values,[f'f{j}' for j in range(8)],sdk.ProjectionPlan(5))
assert result.status is sdk.Status.COMPLETE
encoded = sdk.serialize_json(result);csv = sdk.serialize_point_csv(result)
assert encoded.status is csv.status is sdk.Status.COMPLETE
wire = json.loads(encoded.data)
assert len(wire['neighborhood']['receipts'])==64
P = R = 0
for i in range(64):
    def order(matrix):
        distances = sorted((math.fsum((float(a)-float(b))**2 for a,b in zip(matrix[i],matrix[j])),ids[j])
                           for j in range(64) if i!=j)
        assert all(distances[j+1][0]-distances[j][0]>1e-10 for j in range(len(distances)-1))
        return [id_ for _,id_ in distances]
    original, projected = order(values),order(wire['pca']['scores3'])
    ranks = {id_:rank for rank,id_ in enumerate(original,1)}
    penalty = sum(max(0,ranks[id_]-5) for id_ in projected[:5])
    retained = len(set(original[:5])&set(projected[:5]))
    receipt=wire['neighborhood']['receipts'][i]
    assert receipt['input_neighbors']==original[:5] and receipt['projected_neighbors']==projected[:5]
    assert receipt['penalty']==penalty and receipt['retained_count']==retained
    P+=penalty;R+=retained
T=1-Fraction(2*P,64*5*(128-15-1));retention=Fraction(R,64*5)
assert T==Fraction(115,128)
assert wire['neighborhood']['trustworthiness_fraction']=={'numerator':T.numerator,'denominator':T.denominator}
assert wire['neighborhood']['retention_fraction']=={'numerator':retention.numerator,'denominator':retention.denominator}
assert wire['pca']['fit_receipt']['versions']=={'python':platform.python_version(),**{n:importlib.metadata.version(n) for n in ['numpy','scipy','scikit-learn','threadpoolctl']}}
# Literal serializer fixture is deliberately separate from native PCA output.
constant_wire=json.loads(Path('/consumer/oracles/constant-dto.json').read_text())
constant_result=sdk.ProjectionResult(sdk.Status.COMPLETE,None,dto.ProjectionReport.from_dict(constant_wire))
assert sdk.serialize_json(constant_result).data==Path('/consumer/oracles/constant-dto.json').read_bytes()
assert sdk.serialize_point_csv(constant_result).data==Path('/consumer/oracles/constant-points.csv').read_bytes()
# Measure complete canonical bytes without changing the actual encoder result.
original_encode=core._encode_canonical_json_bytes
sizes=[];samples=[]
def observe_encode(report):
    full=original_encode(report)
    n=4096;k=16
    assert len(report['neighborhood']['receipts'])==n
    p=sum(r['penalty'] for r in report['neighborhood']['receipts'])
    r=sum(q['retained_count'] for q in report['neighborhood']['receipts'])
    t=1-Fraction(2*p,n*k*(2*n-3*k-1));ret=Fraction(r,n*k)
    assert report['neighborhood']['trustworthiness_fraction']=={'numerator':t.numerator,'denominator':t.denominator}
    assert report['neighborhood']['retention_fraction']=={'numerator':ret.numerator,'denominator':ret.denominator}
    ids=report['input']['row_ids'];X=report['input']['values'];Z=report['pca']['scores3']
    for i in [0,1,64,127,128,511,1024,2048,4095]:
        def order(matrix):
            return [id_ for _,id_ in sorted((math.fsum((a-b)**2 for a,b in zip(matrix[i],matrix[j])),ids[j]) for j in range(n) if i!=j)]
        ni,zi=order(X),order(Z)
        ranks={id_:r for r,id_ in enumerate(ni,1)}
        receipt=report['neighborhood']['receipts'][i]
        assert receipt['input_neighbors']==ni[:k] and receipt['projected_neighbors']==zi[:k]
        assert receipt['penalty']==sum(max(0,ranks[id_]-k) for id_ in zi[:k])
        samples.append(i)
    sizes.append({'bytes':len(full),'sha256':hashlib.sha256(full).hexdigest(),'all_receipts':n,'sampled_scalar_receipts':len(samples)})
    return full
core._encode_canonical_json_bytes=observe_encode
large=np.random.default_rng(123).normal(size=(4096,16))
started=time.monotonic()
maximum=sdk.analyze_projection([f'p{i:04d}' for i in range(4096)],large,[f'f{j}' for j in range(16)],sdk.ProjectionPlan(16))
assert len(sizes)==1
if sizes[0]['bytes']<=16777216:
    assert maximum.status is sdk.Status.COMPLETE and maximum.report is not None
else:
    assert maximum.status is sdk.Status.UNKNOWN_BUDGET and maximum.reason=='JSON_BUDGET' and maximum.report is None
assert len(fits)==2 and fits[0]['shape']==[64,8] and fits[1]['shape']==[4096,16]
assert all(all(t==1 for t in f['threads']) for f in fits)
assert all(f['params']=={'n_components':None,'svd_solver':'full','whiten':False,'copy':True} for f in fits)
import subprocess,sys
console=Path(sys.executable).parent/'neighborhood-projection-studio'
assert console.is_file()
cli_run=subprocess.run([str(console),'demo','--assert'],capture_output=True,check=True)
assert not cli_run.stderr
assert json.loads(cli_run.stdout)['neighborhood']['trustworthiness_fraction']=={'numerator':115,'denominator':128}
optimized=subprocess.run([sys.executable,'-I','-B','-O','-m','neighborhood_projection_studio','demo','--assert','--format','csv'],capture_output=True,check=True)
assert not optimized.stderr and optimized.stdout.startswith(b'id,pc1,pc2,pc3,k,neighborhood_state,retained_count,penalty\n')
for name in ['constant','weighted','tied']:
    produced=subprocess.run([str(console),'analyze','--input','/consumer/examples/'+name+'.input.json'],capture_output=True,check=True)
    assert not produced.stderr
    report=json.loads(produced.stdout)
    assert report['schema']=='neighborhood-projection-study/1'
    if name=='constant':assert report['neighborhood']['state']=='UNAVAILABLE_CONSTANT_INPUT'
    if name=='weighted':assert math.isclose(report['pca']['retained_variance_fraction'],56/57,rel_tol=1e-12)
    if name=='tied':assert 'CUTOFF_NEAR_TIE' in report['pca']['flags']
print(json.dumps({'status':'PASS_COLD_REBUILT_WHEEL_PUBLIC_NATIVE_CONSUMER','module':sdk.__file__,
    'module_hashes_checked':len(module_hashes),'notice_files_hash_checked':len(notice['files']),
    'checkout_build_test_compiler_absent':True,'native_fit_receipts':fits,'moderate_json_bytes':len(encoded.data),
    'moderate_json_sha256':hashlib.sha256(encoded.data).hexdigest(),'independent_trustworthiness':[T.numerator,T.denominator],
    'maximum_result_status':str(maximum.status),'maximum_reason':maximum.reason,'maximum_report_present':maximum.report is not None,
    'maximum_complete_private_encoding':sizes[0],'maximum_observed_seconds':time.monotonic()-started,
    'observed_peak_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    'complete_model_testfiles':0,'actual_installed_console_module_demo_O_and_three_inputs':True,'scope':'Real installed rebuilt wheel outside checkout, actual fixed native fits and independent scalar/Fraction receipts, source/legal byte proof, honest16MiB output admission. No browser/quality/portability guarantee.'},allow_nan=False))
