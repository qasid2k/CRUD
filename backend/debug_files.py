import os
import glob

VOICEMAIL_BASE_DIR = "/var/spool/asterisk/voicemail"

def check_files():
    print(f"Checking {VOICEMAIL_BASE_DIR}...")
    if not os.path.exists(VOICEMAIL_BASE_DIR):
        print("Directory does not exist.")
        return

    # Look for any .wav or .txt files recursively
    files = glob.glob(os.path.join(VOICEMAIL_BASE_DIR, "**", "*.wav"), recursive=True)
    txt_files = glob.glob(os.path.join(VOICEMAIL_BASE_DIR, "**", "*.txt"), recursive=True)
    
    print(f"Found {len(files)} .wav files")
    print(f"Found {len(txt_files)} .txt files")
    
    if files:
        print("\nSample files:")
        for f in files[:5]:
            print(f"  - {f}")
            
    # List subdirectories of base dir
    print("\nRoot subdirectories:")
    for entry in os.listdir(VOICEMAIL_BASE_DIR):
        entry_path = os.path.join(VOICEMAIL_BASE_DIR, entry)
        if os.path.isdir(entry_path):
            print(f"  - {entry}/")

if __name__ == "__main__":
    check_files()
