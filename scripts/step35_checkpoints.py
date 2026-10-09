"""Crash-safe extraction publication; never delete or silently rebind old outputs."""
from pathlib import Path
from uuid import uuid4
from step35_evidence import read, save, digest


def code_hashes(scripts=None):
    scripts = Path(scripts or Path(__file__).parent)
    paths = [scripts / name for name in (
        'step35_desktop_review.py', 'step35_evidence.py', 'step35_checkpoints.py')]
    paths += sorted((scripts / 'step35_engine').glob('*.py'))
    return {p.relative_to(scripts).as_posix(): digest(p) for p in paths}


def preserve_partial(path, root, log):
    # Only rename direct children inside the explicitly supplied output directory.
    if path.resolve().parent != root.resolve():
        raise ValueError('Extraction path escapes output directory')
    target = root / (path.name + '.incomplete-' + uuid4().hex[:12])
    path.rename(target)
    log(f'Incomplete export preserved: {target}')


def extraction_files(folder, routes):
    names = [f'{r.lower()}/{n}' for r in routes for n in
             ('access-network.json', 'pbf-extraction-audit.json')]
    return {name: digest(folder / name) for name in names}


def validate_receipt(folder, receipt, binding, routes):
    if receipt.get('binding') != binding:
        raise ValueError('Extraction checkpoint differs; use a new output')
    expected = extraction_files(folder, routes)
    if receipt.get('files') != expected:
        raise ValueError('Saved extraction files changed; keep outputs for diagnosis')


def ensure_extraction(root, binding, routes, extract_to, log):
    """Recover publication after a crash, or preserve partial files and start fresh.

    extract_to is invoked only when no complete, verified export is available.
    It must create the supplied pending directory and return after all exports.
    """
    root = Path(root)
    net = root / 'network'
    pending = root / 'network.pending'
    bp = root / 'network-binding.json'
    done = root / 'network-completed.json'
    if bp.exists() and read(bp) != binding:
        raise ValueError('Saved extraction belongs to different source/code; use a new output')
    if done.exists():
        receipt = read(done)
        # Support historic, completed extraction receipts without modifying them.
        if receipt.get('binding') != binding:
            raise ValueError('Extraction checkpoint differs')
        if all('/' not in k for k in receipt.get('files', {})):
            if set(receipt.get('files', {})) != set(routes):
                raise ValueError('Incomplete extraction checkpoint')
            for route in routes:
                if digest(net / route.lower() / 'access-network.json') != receipt['files'][route]:
                    raise ValueError('Saved network changed')
        else:
            validate_receipt(net, receipt, binding, routes)
        return net
    for folder in (net, pending):
        if not folder.exists():
            continue
        rp = folder / 'extraction-completed.json'
        if rp.exists():
            receipt = read(rp)
            validate_receipt(folder, receipt, binding, routes)
            if folder == pending:
                folder.rename(net)
            save(done, receipt)
            return net
        preserve_partial(folder, root, log)
    save(bp, binding)
    extract_to(pending)
    receipt = {'binding': binding, 'files': extraction_files(pending, routes)}
    save(pending / 'extraction-completed.json', receipt)
    pending.rename(net)
    save(done, receipt)
    return net
