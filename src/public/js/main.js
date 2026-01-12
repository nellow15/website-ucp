// Form validation
document.addEventListener('DOMContentLoaded', function() {
    // Check username availability
    const usernameInput = document.getElementById('username');
    if (usernameInput) {
        usernameInput.addEventListener('blur', function() {
            const username = this.value.trim();
            if (username.length >= 3) {
                checkUsernameAvailability(username);
            }
        });
    }

    // Check email availability
    const emailInput = document.getElementById('email');
    if (emailInput) {
        emailInput.addEventListener('blur', function() {
            const email = this.value.trim();
            if (email.includes('@')) {
                checkEmailAvailability(email);
            }
        });
    }

    // Password strength indicator
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        const strengthIndicator = document.createElement('div');
        strengthIndicator.className = 'password-strength';
        strengthIndicator.style.marginTop = '5px';
        strengthIndicator.style.fontSize = '0.9rem';
        passwordInput.parentNode.appendChild(strengthIndicator);

        passwordInput.addEventListener('input', function() {
            const password = this.value;
            const strength = calculatePasswordStrength(password);
            updateStrengthIndicator(strengthIndicator, strength);
        });
    }

    // Auto-hide alerts after 5 seconds
    const alerts = document.querySelectorAll('.alert');
    alerts.forEach(alert => {
        setTimeout(() => {
            alert.style.opacity = '0';
            alert.style.transition = 'opacity 0.5s ease';
            setTimeout(() => alert.remove(), 500);
        }, 5000);
    });
});

async function checkUsernameAvailability(username) {
    try {
        const response = await fetch(`/api/check-username/${username}`);
        const data = await response.json();
        
        const feedback = document.getElementById('username-feedback');
        if (feedback) {
            if (data.available) {
                feedback.textContent = 'Username is available';
                feedback.style.color = 'green';
            } else {
                feedback.textContent = 'Username is already taken';
                feedback.style.color = 'red';
            }
        }
    } catch (error) {
        console.error('Error checking username:', error);
    }
}

async function checkEmailAvailability(email) {
    try {
        const response = await fetch(`/api/check-email/${email}`);
        const data = await response.json();
        
        const feedback = document.getElementById('email-feedback');
        if (feedback) {
            if (data.available) {
                feedback.textContent = 'Email is available';
                feedback.style.color = 'green';
            } else {
                feedback.textContent = 'Email is already registered';
                feedback.style.color = 'red';
            }
        }
    } catch (error) {
        console.error('Error checking email:', error);
    }
}

function calculatePasswordStrength(password) {
    let strength = 0;
    
    if (password.length >= 8) strength += 1;
    if (/[A-Z]/.test(password)) strength += 1;
    if (/[a-z]/.test(password)) strength += 1;
    if (/[0-9]/.test(password)) strength += 1;
    if (/[^A-Za-z0-9]/.test(password)) strength += 1;
    
    return Math.min(strength, 5);
}

function updateStrengthIndicator(element, strength) {
    const colors = ['#e53e3e', '#dd6b20', '#d69e2e', '#38a169', '#38a169'];
    const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
    
    element.textContent = `Strength: ${labels[strength - 1] || 'Very Weak'}`;
    element.style.color = colors[strength - 1] || '#e53e3e';
}

// Form submission prevention with validation
document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', function(e) {
        const requiredFields = this.querySelectorAll('[required]');
        let valid = true;
        
        requiredFields.forEach(field => {
            if (!field.value.trim()) {
                valid = false;
                field.style.borderColor = '#e53e3e';
                
                // Add error message
                let errorMsg = field.parentNode.querySelector('.field-error');
                if (!errorMsg) {
                    errorMsg = document.createElement('div');
                    errorMsg.className = 'field-error';
                    errorMsg.style.color = '#e53e3e';
                    errorMsg.style.fontSize = '0.9rem';
                    errorMsg.style.marginTop = '5px';
                    field.parentNode.appendChild(errorMsg);
                }
                errorMsg.textContent = 'This field is required';
            } else {
                field.style.borderColor = '#e2e8f0';
                const errorMsg = field.parentNode.querySelector('.field-error');
                if (errorMsg) errorMsg.remove();
            }
        });
        
        if (!valid) {
            e.preventDefault();
        }
    });
});