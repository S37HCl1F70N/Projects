.PHONY: validate test e2e check-install
validate:
	PYTHONPATH=src python3 scripts/validate-project.py

test:
	PYTHONPATH=src python3 -m unittest discover -s tests -v

e2e:
	PYTHONPATH=src ./scripts/e2e-test.sh

check-install:
	./install.sh --check-only
