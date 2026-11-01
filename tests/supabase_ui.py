"""Backward-compatible entry point: email login UI was replaced by invitations."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('pairing_ui.py')),run_name='__main__')
