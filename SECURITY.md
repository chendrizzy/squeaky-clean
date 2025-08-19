# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Currently supported versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.0.x   | :white_check_mark: |
| < 0.0.1 | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within squeaky-clean, please follow these steps:

1. **DO NOT** open a public issue
2. Email details to: [your-email@example.com] or create a private security advisory on GitHub
3. Include the following information:
   - Type of vulnerability
   - Full paths of source file(s) related to the vulnerability
   - Step-by-step instructions to reproduce
   - Proof-of-concept or exploit code (if possible)
   - Impact of the vulnerability

## Response Timeline

- We will acknowledge your email within 48 hours
- We will provide a detailed response within 7 days
- We will release a patch as soon as possible (typically within 30 days)

## Security Best Practices

When using squeaky-clean:

1. **Always run with `--dry-run` first** to preview what will be deleted
2. **Review the configuration** before running cleanup operations
3. **Keep the tool updated** to get the latest security patches
4. **Use restricted permissions** when possible
5. **Avoid running with sudo/admin** unless absolutely necessary

## Security Features

squeaky-clean includes several security features:

- **Dry-run mode**: Preview operations before execution
- **Home directory protection**: Won't delete files outside user's home by default
- **Configuration validation**: Validates all configuration before execution
- **Safe defaults**: Conservative default settings
- **No eval() usage**: No dynamic code execution
- **Command sanitization**: All shell commands are properly escaped

## Dependencies

We regularly update our dependencies and run security audits:

- `npm audit` is run in CI/CD pipeline
- Dependencies are automatically updated weekly
- Security patches are prioritized

## Contact

For security concerns, please contact the maintainers directly rather than opening public issues.