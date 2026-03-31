# Cafezin 0.1.12

Cafezin 0.1.12 introduces smarter AI session tracking and compression improvements, ensuring better context retention and coherence during extended writing sessions.

## Highlights

- Session goal anchoring: The app now retains the user's initial message as an anchor throughout the session, helping the AI stay focused on the user's intent even during long interactions.
- File read cache: Cafezin tracks files read during a session, enabling the AI to avoid redundant re-reads and prioritize fresh or changed files for improved efficiency.
- Enhanced context compression: Mixed messages (e.g., user and assistant) are now preserved during compression, ensuring better coherence and avoiding loss of critical information.
- Sliding window improvements: Groups of related messages, such as tool results and their parent assistant messages, are kept intact during token budget enforcement, preventing unintended drops and maintaining context consistency.

## Downloads

- macOS: https://cafezin.pmatz.com/download/mac
- Windows: https://cafezin.pmatz.com/download/windows

## Full release

https://github.com/pvsmartinez/cafezin/releases/tag/v0.1.12
